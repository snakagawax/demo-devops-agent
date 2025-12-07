#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { DynamoDBThrottleStack } from '../lib/dynamodb-throttle-stack';

const app = new cdk.App();

new DynamoDBThrottleStack(app, 'DemoDevOpsAgentStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  },
  // Initial configuration: WCU=5 for normal operation
  // To trigger throttling, change to WCU=1
  writeCapacity: 1,
  readCapacity: 1,
});

app.synth();
