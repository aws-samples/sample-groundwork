// Copyright GroundWork. SPDX-License-Identifier: Apache-2.0
import * as cdk from "aws-cdk-lib";
import { Annotations, Match, Template } from "aws-cdk-lib/assertions";
import {
  COA_DATA_TOOLS,
  COA_DISCOVERY_TOOLS,
  COA_MCP_TOOLS,
  GatewayStack,
  InboundAuthMode,
  toPolicyName,
} from "../lib/gateway-stack";

const MCP_ENDPOINT =
  "https://bedrock-agentcore.us-east-1.amazonaws.com/runtimes/abc123/mcp";
const DISCOVERY_URL = "https://idp.example.com/.well-known/openid-configuration";

function synth(overrides: Partial<Parameters<typeof makeStack>[0]> = {}) {
  const { stack } = makeStack(overrides);
  return Template.fromStack(stack);
}

function makeStack(
  overrides: {
    authMode?: InboundAuthMode;
    discoveryUrl?: string;
    allowedAudience?: string[];
    enablePolicyEngine?: boolean;
    policyEngineAuditOnly?: boolean;
    enableSemanticSearch?: boolean;
    coaMcpEndpoint?: string;
  } = {},
) {
  const app = new cdk.App();
  const stack = new GatewayStack(app, "TestGateway", {
    coaMcpEndpoint: overrides.coaMcpEndpoint ?? MCP_ENDPOINT,
    authMode: overrides.authMode ?? InboundAuthMode.JWT,
    discoveryUrl:
      overrides.discoveryUrl ??
      (overrides.authMode === InboundAuthMode.JWT || overrides.authMode === undefined
        ? DISCOVERY_URL
        : undefined),
    allowedAudience: overrides.allowedAudience ?? ["groundwork-gateway"],
    enablePolicyEngine: overrides.enablePolicyEngine,
    policyEngineAuditOnly: overrides.policyEngineAuditOnly,
    enableSemanticSearch: overrides.enableSemanticSearch,
    env: { account: "123456789012", region: "us-east-1" },
  });
  return { app, stack };
}

describe("GatewayStack", () => {
  describe("gateway", () => {
    it("creates exactly one gateway with an MCP protocol", () => {
      const template = synth();
      template.resourceCountIs("AWS::BedrockAgentCore::Gateway", 1);
      template.hasResourceProperties("AWS::BedrockAgentCore::Gateway", {
        ProtocolType: "MCP",
      });
    });

    it("enables semantic tool search by default", () => {
      // COA adds six tools to whatever the customer already has; without search,
      // model tool selection degrades.
      const template = synth();
      template.hasResourceProperties("AWS::BedrockAgentCore::Gateway", {
        ProtocolConfiguration: Match.objectLike({
          Mcp: Match.objectLike({ SearchType: "SEMANTIC" }),
        }),
      });
    });

    it("can disable semantic search", () => {
      const template = synth({ enableSemanticSearch: false });
      const gateways = template.findResources("AWS::BedrockAgentCore::Gateway");
      const config = Object.values(gateways)[0].Properties.ProtocolConfiguration;
      expect(JSON.stringify(config ?? {})).not.toContain("SEMANTIC");
    });

    it("gives the gateway an execution role assumable by AgentCore", () => {
      const template = synth();
      template.hasResourceProperties("AWS::IAM::Role", {
        AssumeRolePolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Principal: { Service: "bedrock-agentcore.amazonaws.com" },
            }),
          ]),
        }),
      });
    });
  });

  describe("COA MCP target", () => {
    it("registers COA's MCP server as a target, not the other way round", () => {
      // The direction matters: COA already runs an MCP server. We front it.
      const template = synth();
      template.resourceCountIs("AWS::BedrockAgentCore::GatewayTarget", 1);
      template.hasResourceProperties("AWS::BedrockAgentCore::GatewayTarget", {
        Name: "coa",
      });
    });

    it("points the target at the supplied COA endpoint", () => {
      const template = synth();
      const targets = template.findResources("AWS::BedrockAgentCore::GatewayTarget");
      expect(JSON.stringify(Object.values(targets)[0])).toContain(MCP_ENDPOINT);
    });

    it("rejects a non-https endpoint", () => {
      expect(() =>
        makeStack({ coaMcpEndpoint: "http://insecure.example.com/mcp" }),
      ).toThrow(/must be an https URL/);
    });

    it("rejects an empty endpoint", () => {
      expect(() => makeStack({ coaMcpEndpoint: "" })).toThrow(/required/);
    });
  });

  describe("inbound auth", () => {
    it("JWT mode configures a custom JWT authorizer", () => {
      const template = synth({ authMode: InboundAuthMode.JWT });
      template.hasResourceProperties("AWS::BedrockAgentCore::Gateway", {
        AuthorizerType: "CUSTOM_JWT",
        AuthorizerConfiguration: Match.objectLike({
          CustomJWTAuthorizer: Match.objectLike({
            DiscoveryUrl: DISCOVERY_URL,
            AllowedAudience: ["groundwork-gateway"],
          }),
        }),
      });
    });

    it("JWT mode requires a discovery URL", () => {
      expect(() =>
        makeStack({ authMode: InboundAuthMode.JWT, discoveryUrl: "" }),
      ).toThrow(/discoveryUrl is required/);
    });

    it("refuses JWT mode with no audience or client restriction", () => {
      // Otherwise the gateway accepts any token the issuer minted, including
      // tokens issued for a different application.
      expect(() => makeStack({ allowedAudience: [] })).toThrow(
        /requires allowedAudience or allowedClients/,
      );
    });

    it("IAM mode configures AWS_IAM", () => {
      const template = synth({ authMode: InboundAuthMode.IAM });
      template.hasResourceProperties("AWS::BedrockAgentCore::Gateway", {
        AuthorizerType: "AWS_IAM",
      });
    });

    it("passthrough mode configures NONE and switches the target to JWT_PASSTHROUGH", () => {
      const template = synth({ authMode: InboundAuthMode.NONE_PASSTHROUGH });
      template.hasResourceProperties("AWS::BedrockAgentCore::Gateway", {
        AuthorizerType: "NONE",
      });
      template.hasResourceProperties("AWS::BedrockAgentCore::GatewayTarget", {
        CredentialProviderConfigurations: [{ CredentialProviderType: "JWT_PASSTHROUGH" }],
      });
    });

    it("warns loudly about passthrough mode", () => {
      // AWS documents this for onboarding only. The warning is the guardrail.
      const { stack } = makeStack({ authMode: InboundAuthMode.NONE_PASSTHROUGH });
      Annotations.fromStack(stack).hasWarning(
        "*",
        Match.stringLikeRegexp("onboarding and testing only"),
      );
    });

    it("warns extra when passthrough is combined with no policy engine", () => {
      const { stack } = makeStack({
        authMode: InboundAuthMode.NONE_PASSTHROUGH,
        enablePolicyEngine: false,
      });
      Annotations.fromStack(stack).hasWarning(
        "*",
        Match.stringLikeRegexp("entirely.*unauthorized|any caller reaches COA"),
      );
    });
  });

  describe("Cedar policy engine", () => {
    it("is created by default and attached to the gateway", () => {
      const template = synth();
      template.resourceCountIs("AWS::BedrockAgentCore::PolicyEngine", 1);
      template.hasResourceProperties("AWS::BedrockAgentCore::Gateway", {
        PolicyEngineConfiguration: Match.objectLike({ Mode: "ENFORCE" }),
      });
    });

    it("can be disabled", () => {
      const template = synth({ enablePolicyEngine: false });
      template.resourceCountIs("AWS::BedrockAgentCore::PolicyEngine", 0);
      template.resourceCountIs("AWS::BedrockAgentCore::Policy", 0);
    });

    it("creates two policies: permit discovery, restrict data", () => {
      const template = synth();
      template.resourceCountIs("AWS::BedrockAgentCore::Policy", 2);
    });

    it("permits discovery tools for any principal", () => {
      const template = synth();
      const policies = template.findResources("AWS::BedrockAgentCore::Policy");
      const discovery = Object.values(policies).find((p) =>
        p.Properties.Name.includes("allow_discovery"),
      );
      const statement = discovery!.Properties.Definition.Cedar.Statement as string;

      expect(statement).toContain("permit");
      for (const tool of COA_DISCOVERY_TOOLS) {
        expect(statement).toContain(`coa___${tool}`);
      }
    });

    it("forbids data tools without the data-access scope", () => {
      const template = synth();
      const policies = template.findResources("AWS::BedrockAgentCore::Policy");
      const restrict = Object.values(policies).find((p) =>
        p.Properties.Name.includes("restrict_data"),
      );
      const statement = restrict!.Properties.Definition.Cedar.Statement as string;

      expect(statement).toContain("forbid");
      expect(statement).toContain("groundwork:data-access");
      for (const tool of COA_DATA_TOOLS) {
        expect(statement).toContain(`coa___${tool}`);
      }
    });

    it("does not put discovery tools under the data restriction", () => {
      // describe_schema returning class names is not a data disclosure, and
      // gating it would stop an agent from orienting itself at all.
      const template = synth();
      const policies = template.findResources("AWS::BedrockAgentCore::Policy");
      const restrict = Object.values(policies).find((p) =>
        p.Properties.Name.includes("restrict_data"),
      );
      const statement = restrict!.Properties.Definition.Cedar.Statement as string;

      for (const tool of COA_DISCOVERY_TOOLS) {
        expect(statement).not.toContain(`coa___${tool}`);
      }
    });

    it("audit-only mode uses LOG_ONLY on both the engine and every policy", () => {
      // Two different enums: Gateway mode is ENFORCE|LOG_ONLY, Policy
      // EnforcementMode is ACTIVE|LOG_ONLY. Only LOG_ONLY is shared.
      const template = synth({ policyEngineAuditOnly: true });
      template.hasResourceProperties("AWS::BedrockAgentCore::Gateway", {
        PolicyEngineConfiguration: Match.objectLike({ Mode: "LOG_ONLY" }),
      });
      const policies = template.findResources("AWS::BedrockAgentCore::Policy");
      for (const policy of Object.values(policies)) {
        expect(policy.Properties.EnforcementMode).toBe("LOG_ONLY");
      }
    });

    it("enforcing mode uses ACTIVE on policies, not the gateway's ENFORCE", () => {
      const template = synth();
      const policies = template.findResources("AWS::BedrockAgentCore::Policy");
      for (const policy of Object.values(policies)) {
        expect(policy.Properties.EnforcementMode).toBe("ACTIVE");
      }
    });

    it("policy names satisfy the no-hyphens pattern CloudFormation enforces", () => {
      const template = synth();
      const pattern = /^[A-Za-z][A-Za-z0-9_]*$/;
      for (const policy of Object.values(
        template.findResources("AWS::BedrockAgentCore::Policy"),
      )) {
        expect(policy.Properties.Name).toMatch(pattern);
      }
      for (const engine of Object.values(
        template.findResources("AWS::BedrockAgentCore::PolicyEngine"),
      )) {
        expect(engine.Properties.Name).toMatch(pattern);
      }
    });

    it("covers every COA tool across the two policies", () => {
      // A tool absent from both policies would be silently unreachable.
      const union = [...COA_DISCOVERY_TOOLS, ...COA_DATA_TOOLS].sort();
      expect(union).toEqual([...COA_MCP_TOOLS].sort());
    });
  });

  describe("outputs", () => {
    it("publishes the gateway ARN and the aggregated tool names", () => {
      const template = synth();
      const outputs = template.findOutputs("*");
      const keys = Object.keys(outputs);

      expect(keys).toContain("GatewayArn");
      expect(keys).toContain("AggregatedTools");
      expect(keys).toContain("InboundAuthMode");
      expect(outputs.AggregatedTools.Value).toContain("coa___query");
    });

    it("records the upstream COA endpoint for traceability", () => {
      const template = synth();
      expect(template.findOutputs("CoaMcpEndpoint").CoaMcpEndpoint.Value).toBe(
        MCP_ENDPOINT,
      );
    });
  });
});

describe("toPolicyName", () => {
  it("replaces characters CloudFormation rejects", () => {
    expect(toPolicyName("groundwork-prod")).toBe("groundwork_prod");
    expect(toPolicyName("cf.demo/1")).toBe("cf_demo_1");
  });

  it("prefixes a name that does not start with a letter", () => {
    expect(toPolicyName("1st-run")).toBe("p_1st_run");
    expect(toPolicyName("_leading")).toBe("p__leading");
  });

  it("leaves an already-valid name alone", () => {
    expect(toPolicyName("groundwork")).toBe("groundwork");
  });
});
