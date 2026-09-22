// Copyright GroundWork. SPDX-License-Identifier: Apache-2.0
import * as cdk from "aws-cdk-lib";
import * as bedrockagentcore from "aws-cdk-lib/aws-bedrockagentcore";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

/**
 * Inbound authorization mode for the gateway.
 *
 * This is the decision that resolves COA's machine-to-machine gap. COA itself
 * has no M2M credentials — its own docs state agents "always act on behalf of a
 * user using the same OIDC three-legged (3LO) auth flow as the web app". A
 * customer's autonomous agents have no user token to present, so the gateway is
 * where that gets solved.
 */
export enum InboundAuthMode {
  /**
   * CUSTOM_JWT against the customer's IdP. The IdP issues client-credentials
   * tokens for service principals, which COA then maps to grants.
   *
   * This is the production choice.
   */
  JWT = "jwt",

  /**
   * AWS_IAM. The caller's SigV4 identity authorizes the gateway invocation.
   * Suitable when every caller is already an IAM principal in the same account.
   */
  IAM = "iam",

  /**
   * NONE inbound + JWT passthrough outbound. The gateway forwards the caller's
   * token to COA unchanged, so COA validates it exactly as it does today.
   *
   * Zero-friction onboarding, and AWS explicitly advises against it for
   * production: the same token is accepted by both gateway and target, so it
   * must be tightly audience-scoped. Move to on-behalf-of exchange before any
   * customer pilot. Selecting this mode emits a stack-level warning.
   */
  NONE_PASSTHROUGH = "none-passthrough",
}

export interface GatewayStackProps extends cdk.StackProps {
  /**
   * COA's MCP server endpoint — the AgentCore Runtime URL from COA's mcp-stack
   * output, ending in /mcp.
   */
  readonly coaMcpEndpoint: string;

  /** Inbound authorization mode. @default InboundAuthMode.JWT */
  readonly authMode?: InboundAuthMode;

  /**
   * OIDC discovery URL. Required when authMode is JWT.
   * e.g. https://your-idp/.well-known/openid-configuration
   */
  readonly discoveryUrl?: string;

  /** Allowed `aud` values. Strongly recommended with JWT. */
  readonly allowedAudience?: string[];

  /** Allowed client ids. */
  readonly allowedClients?: string[];

  /**
   * Attach a Cedar policy engine for tool-level authorization.
   *
   * Keep the division of labour clear: COA's internal cedar_authorizer stays
   * authoritative for DATA-level decisions, because its table allowlist and
   * column denylist run inside the SQL firewall path — the strongest control in
   * the stack. The gateway policy engine handles coarse TOOL-level access only.
   * Do not mirror table grants here; the two will drift.
   *
   * @default true
   */
  readonly enablePolicyEngine?: boolean;

  /**
   * Start the policy engine in permissive mode, logging decisions without
   * enforcing them. Useful for a first deployment against an existing agent
   * fleet where you do not yet know which agents call which tools.
   *
   * @default false
   */
  readonly policyEngineAuditOnly?: boolean;

  /**
   * Enable semantic tool search (`x_amz_bedrock_agentcore_search`).
   *
   * Worth leaving on. COA contributes six tools; once those are aggregated with
   * a customer's existing dozens, model tool-selection accuracy degrades without
   * a search affordance.
   *
   * @default true
   */
  readonly enableSemanticSearch?: boolean;

  /** Prefix for resource names. @default "groundwork" */
  readonly namePrefix?: string;
}

/**
 * The six tools COA's MCP server exposes, verified against
 * packages/mcp-server/src/coa_mcp/server.py.
 *
 * Gateway prefixes tool names with the target name, so an agent sees
 * `coa___query` rather than `query`. The Cedar policies below account for that.
 */
export const COA_MCP_TOOLS = [
  "query",
  "translate_sparql",
  "rag_retrieval",
  "graph_traversal",
  "list_metrics",
  "describe_schema",
] as const;

/** Tools that only read schema/metric metadata — safe for broad access. */
export const COA_DISCOVERY_TOOLS = ["list_metrics", "describe_schema"] as const;

/** Tools that reach actual customer data. Narrower access warranted. */
export const COA_DATA_TOOLS = [
  "query",
  "translate_sparql",
  "rag_retrieval",
  "graph_traversal",
] as const;

const COA_TARGET_NAME = "coa";

/**
 * Coerce a name into `^[A-Za-z][A-Za-z0-9_]*$`, which is what PolicyEngine and
 * Policy require. Every other AgentCore resource accepts hyphens, so a prefix
 * like "groundwork-prod" is perfectly valid elsewhere and rejected here.
 */
export function toPolicyName(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_]/g, "_");
  return /^[A-Za-z]/.test(cleaned) ? cleaned : `p_${cleaned}`;
}

export class GatewayStack extends cdk.Stack {
  public readonly gateway: bedrockagentcore.Gateway;
  public readonly gatewayUrl: string;
  public readonly policyEngine?: bedrockagentcore.CfnPolicyEngine;

  constructor(scope: Construct, id: string, props: GatewayStackProps) {
    super(scope, id, props);

    const prefix = props.namePrefix ?? "groundwork";
    const authMode = props.authMode ?? InboundAuthMode.JWT;
    const enablePolicyEngine = props.enablePolicyEngine ?? true;
    const enableSemanticSearch = props.enableSemanticSearch ?? true;

    this.validateProps(props, authMode, enablePolicyEngine);

    // ── Gateway execution role ───────────────────────────────────────────────
    const gatewayRole = new iam.Role(this, "GatewayRole", {
      assumedBy: new iam.ServicePrincipal("bedrock-agentcore.amazonaws.com"),
      description: "Execution role for the GroundWork AgentCore Gateway",
    });

    // ── Inbound authorization ────────────────────────────────────────────────
    const authorizerConfiguration = this.buildAuthorizer(props, authMode);

    // ── Gateway ──────────────────────────────────────────────────────────────
    this.gateway = new bedrockagentcore.Gateway(this, "Gateway", {
      gatewayName: `${prefix}-gateway`,
      description:
        "Aggregates the Context Ontology Accelerator MCP server with the customer's " +
        "own tool targets behind one MCP endpoint",
      role: gatewayRole,
      protocolConfiguration: bedrockagentcore.GatewayProtocol.mcp({
        instructions:
          "Governed context from an ontology-backed knowledge graph. Use describe_schema " +
          "to discover available classes before composing a query, and list_metrics to " +
          "find governed metric definitions rather than computing values ad hoc.",
        ...(enableSemanticSearch
          ? { searchType: bedrockagentcore.McpGatewaySearchType.SEMANTIC }
          : {}),
      }),
      authorizerConfiguration,
    });

    this.gatewayUrl = this.gateway.gatewayUrl ?? "";

    // ── COA MCP server as a target ───────────────────────────────────────────
    // MCP targets operate in aggregation mode: the gateway presents itself as a
    // single MCP server combining every target's tools.
    //
    // Note the direction of travel. COA already runs an MCP server on AgentCore
    // Runtime; we are NOT registering GroundWork as an MCP server. The gateway
    // fronts COA's existing one.
    const coaTarget = bedrockagentcore.GatewayTarget.forMcpServer(this, "CoaMcpTarget", {
      gateway: this.gateway,
      gatewayTargetName: COA_TARGET_NAME,
      description: "Context Ontology Accelerator MCP server (AgentCore Runtime)",
      endpoint: props.coaMcpEndpoint,
      credentialProviderConfigurations: [
        bedrockagentcore.GatewayCredentialProvider.fromIamRole({
          service: "bedrock-agentcore",
        }),
      ],
    });

    if (authMode === InboundAuthMode.NONE_PASSTHROUGH) {
      this.applyJwtPassthrough(coaTarget);
    }

    // ── Cedar policy engine (tool-level only) ────────────────────────────────
    if (enablePolicyEngine) {
      this.policyEngine = this.buildPolicyEngine(prefix, props.policyEngineAuditOnly ?? false);
    }

    this.addOutputs(props, authMode, enableSemanticSearch);
  }

  private validateProps(
    props: GatewayStackProps,
    authMode: InboundAuthMode,
    enablePolicyEngine: boolean,
  ): void {
    if (!props.coaMcpEndpoint) {
      throw new Error("coaMcpEndpoint is required");
    }
    if (!props.coaMcpEndpoint.startsWith("https://")) {
      throw new Error(
        `coaMcpEndpoint must be an https URL, got: ${props.coaMcpEndpoint}`,
      );
    }

    if (authMode === InboundAuthMode.JWT && !props.discoveryUrl) {
      throw new Error("discoveryUrl is required when authMode is JWT");
    }

    // The CDK L2 also enforces this (CustomJwtConfigurationRequired), but its
    // message does not say why it matters. Fail first, with the reason.
    if (
      authMode === InboundAuthMode.JWT &&
      !props.allowedAudience?.length &&
      !props.allowedClients?.length
    ) {
      throw new Error(
        "authMode=JWT requires allowedAudience or allowedClients. Without an audience " +
          "or client restriction the gateway accepts ANY token the issuer minted, " +
          "including tokens issued for a different application entirely.",
      );
    }

    if (authMode === InboundAuthMode.NONE_PASSTHROUGH) {
      cdk.Annotations.of(this).addWarning(
        "authMode=NONE_PASSTHROUGH means the gateway performs NO inbound authorization " +
          "and forwards the caller's token to COA unchanged. AWS documents this for " +
          "onboarding and testing only. Move to InboundAuthMode.JWT with on-behalf-of " +
          "token exchange before any customer pilot.",
      );
      if (!enablePolicyEngine) {
        cdk.Annotations.of(this).addWarning(
          "NONE_PASSTHROUGH with enablePolicyEngine=false leaves the gateway entirely " +
            "unauthorized — any caller reaches COA, and only COA's own token validation " +
            "stands between them and the data.",
        );
      }
    }
  }

  private buildAuthorizer(
    props: GatewayStackProps,
    authMode: InboundAuthMode,
  ): bedrockagentcore.IGatewayAuthorizerConfig {
    switch (authMode) {
      case InboundAuthMode.JWT:
        return bedrockagentcore.GatewayAuthorizer.usingCustomJwt({
          discoveryUrl: props.discoveryUrl!,
          ...(props.allowedAudience?.length ? { allowedAudience: props.allowedAudience } : {}),
          ...(props.allowedClients?.length ? { allowedClients: props.allowedClients } : {}),
        });

      case InboundAuthMode.IAM:
        return bedrockagentcore.GatewayAuthorizer.usingAwsIam();

      case InboundAuthMode.NONE_PASSTHROUGH:
        return bedrockagentcore.GatewayAuthorizer.withNoAuth();
    }
  }

  /**
   * Switch the target's outbound credential provider to JWT passthrough.
   *
   * L1 escape hatch: aws-cdk-lib 2.265 has no L2 helper for JWT_PASSTHROUGH or
   * CALLER_IAM_CREDENTIALS, so the credentialProviderType is set directly on the
   * underlying CfnGatewayTarget. Revisit when the L2 adds it.
   */
  private applyJwtPassthrough(target: bedrockagentcore.GatewayTarget): void {
    const cfnTarget = target.node.defaultChild as bedrockagentcore.CfnGatewayTarget;
    cfnTarget.addPropertyOverride("CredentialProviderConfigurations", [
      { CredentialProviderType: "JWT_PASSTHROUGH" },
    ]);
  }

  /**
   * Cedar policy engine, attached to the gateway.
   *
   * L1 escape hatch again: GatewayProps has no policyEngineConfiguration, though
   * CfnGateway does.
   */
  private buildPolicyEngine(
    prefix: string,
    auditOnly: boolean,
  ): bedrockagentcore.CfnPolicyEngine {
    // PolicyEngine and Policy names must match ^[A-Za-z][A-Za-z0-9_]*$ — no
    // hyphens, unlike almost every other AgentCore resource name.
    const safePrefix = toPolicyName(prefix);

    const engine = new bedrockagentcore.CfnPolicyEngine(this, "PolicyEngine", {
      name: `${safePrefix}_tool_policies`,
      description: "Tool-level authorization for the GroundWork gateway",
    });

    // Two distinct enums, easy to conflate:
    //   Policy.EnforcementMode              ACTIVE  | LOG_ONLY   (default ACTIVE)
    //   Gateway.PolicyEngineConfiguration   ENFORCE | LOG_ONLY
    const policyMode = auditOnly ? "LOG_ONLY" : "ACTIVE";
    const engineMode = auditOnly ? "LOG_ONLY" : "ENFORCE";

    // Discovery tools are metadata-only — no customer rows are returned — so any
    // authenticated principal may call them. This is what lets an agent orient
    // itself before asking for data.
    new bedrockagentcore.CfnPolicy(this, "AllowDiscoveryTools", {
      name: `${safePrefix}_allow_discovery`,
      policyEngineId: engine.attrPolicyEngineId,
      description: "Any authenticated principal may inspect schema and metric definitions",
      enforcementMode: policyMode,
      definition: {
        cedar: {
          statement: [
            "permit (",
            "  principal,",
            `  action in [${COA_DISCOVERY_TOOLS.map(
              (tool) => `Action::"${COA_TARGET_NAME}___${tool}"`,
            ).join(", ")}],`,
            "  resource",
            ");",
          ].join("\n"),
        },
      },
    });

    // Data tools require an explicit `groundwork:data-access` scope. Absent a
    // grant of that scope the tool is denied at the gateway, before COA is
    // reached at all — which keeps unauthorised traffic off the Neptune and
    // Bedrock cost paths, not just off the data.
    new bedrockagentcore.CfnPolicy(this, "RestrictDataTools", {
      name: `${safePrefix}_restrict_data`,
      policyEngineId: engine.attrPolicyEngineId,
      description: "Data-reaching tools require the groundwork:data-access scope",
      enforcementMode: policyMode,
      definition: {
        cedar: {
          statement: [
            "forbid (",
            "  principal,",
            `  action in [${COA_DATA_TOOLS.map(
              (tool) => `Action::"${COA_TARGET_NAME}___${tool}"`,
            ).join(", ")}],`,
            "  resource",
            ")",
            'unless { context.scopes has "groundwork:data-access" };',
          ].join("\n"),
        },
      },
    });

    const cfnGateway = this.gateway.node.defaultChild as bedrockagentcore.CfnGateway;
    cfnGateway.addPropertyOverride("PolicyEngineConfiguration", {
      Arn: engine.attrPolicyEngineArn,
      Mode: engineMode,
    });

    return engine;
  }

  private addOutputs(
    props: GatewayStackProps,
    authMode: InboundAuthMode,
    semanticSearch: boolean,
  ): void {
    new cdk.CfnOutput(this, "GatewayArn", {
      value: this.gateway.gatewayArn,
      description: "Gateway ARN — scope bedrock-agentcore:InvokeGateway to this",
    });

    new cdk.CfnOutput(this, "GatewayId", { value: this.gateway.gatewayId });

    if (this.gateway.gatewayUrl) {
      new cdk.CfnOutput(this, "GatewayUrl", {
        value: this.gateway.gatewayUrl,
        description: "MCP endpoint for agents. Point existing MCP clients here.",
      });
    }

    new cdk.CfnOutput(this, "CoaMcpEndpoint", {
      value: props.coaMcpEndpoint,
      description: "Upstream COA MCP server this gateway fronts",
    });

    new cdk.CfnOutput(this, "InboundAuthMode", { value: authMode });

    new cdk.CfnOutput(this, "SemanticSearch", {
      value: semanticSearch ? "enabled" : "disabled",
    });

    new cdk.CfnOutput(this, "AggregatedTools", {
      value: COA_MCP_TOOLS.map((tool) => `${COA_TARGET_NAME}___${tool}`).join(", "),
      description: "Tool names agents will see (gateway prefixes with the target name)",
    });

    if (this.policyEngine) {
      new cdk.CfnOutput(this, "PolicyEngineArn", {
        value: this.policyEngine.attrPolicyEngineArn,
      });
    }
  }
}
