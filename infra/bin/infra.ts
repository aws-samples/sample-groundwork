#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { GroundworkStack } from "../lib/infra-stack";

const app = new cdk.App();
new GroundworkStack(app, "GroundworkStack", {
  env: { region: "us-west-2" },
});
