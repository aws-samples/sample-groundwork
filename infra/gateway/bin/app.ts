#!/usr/bin/env node
// Copyright GroundWork. SPDX-License-Identifier: Apache-2.0
//
// Deploy:
//   npx cdk deploy \
//     -c coaMcpEndpoint=https://bedrock-agentcore.us-east-1.amazonaws.com/runtimes/.../mcp \
//     -c authMode=jwt \
//     -c discoveryUrl=https://your-idp/.well-known/openid-configuration \
//     -c allowedAudience=groundwork-gateway
//
// Everything is context-driven rather than env-var driven so `cdk synth` output
// is reproducible from the command line alone.

import * as cdk from "aws-cdk-lib";
import { GatewayStack, InboundAuthMode } from "../lib/gateway-stack";

const app = new cdk.App();

function requiredContext(key: string): string {
  const value = app.node.tryGetContext(key);
  if (!value) {
    throw new Error(`missing required context: -c ${key}=<value>`);
  }
  return String(value);
}

function optionalContext(key: string): string | undefined {
  const value = app.node.tryGetContext(key);
  return value ? String(value) : undefined;
}

function listContext(key: string): string[] | undefined {
  const value = optionalContext(key);
  return value
    ? value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : undefined;
}

function boolContext(key: string, fallback: boolean): boolean {
  const value = optionalContext(key);
  if (value === undefined) {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function parseAuthMode(raw: string | undefined): InboundAuthMode {
  const value = (raw ?? InboundAuthMode.JWT).toLowerCase();
  const valid = Object.values(InboundAuthMode) as string[];
  if (!valid.includes(value)) {
    throw new Error(`invalid authMode '${raw}'; expected one of ${valid.join(", ")}`);
  }
  return value as InboundAuthMode;
}

const prefix = optionalContext("namePrefix") ?? "groundwork";

new GatewayStack(app, `${prefix}-gateway`, {
  coaMcpEndpoint: requiredContext("coaMcpEndpoint"),
  authMode: parseAuthMode(optionalContext("authMode")),
  discoveryUrl: optionalContext("discoveryUrl"),
  allowedAudience: listContext("allowedAudience"),
  allowedClients: listContext("allowedClients"),
  enablePolicyEngine: boolContext("enablePolicyEngine", true),
  policyEngineAuditOnly: boolContext("policyEngineAuditOnly", false),
  enableSemanticSearch: boolContext("enableSemanticSearch", true),
  namePrefix: prefix,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? "us-east-1",
  },
  description:
    "AgentCore Gateway fronting the Context Ontology Accelerator MCP server, " +
    "so existing agents reach governed context through one endpoint",
});

app.synth();
