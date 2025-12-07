import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import { Construct } from 'constructs';
import * as path from 'path';

export interface DynamoDBThrottleStackProps extends cdk.StackProps {
  /**
   * DynamoDB Write Capacity Units
   * @default 5
   */
  writeCapacity?: number;

  /**
   * DynamoDB Read Capacity Units
   * @default 5
   */
  readCapacity?: number;
}

export class DynamoDBThrottleStack extends cdk.Stack {
  public readonly table: dynamodb.Table;
  public readonly writerFunction: lambda.Function;
  public readonly webhookNotifierFunction: lambda.Function;

  constructor(scope: Construct, id: string, props?: DynamoDBThrottleStackProps) {
    super(scope, id, props);

    const writeCapacity = props?.writeCapacity ?? 5;
    const readCapacity = props?.readCapacity ?? 5;

    // ===========================================
    // DynamoDB Table
    // ===========================================
    this.table = new dynamodb.Table(this, 'ThrottleTestTable', {
      tableName: 'demo-devops-agent-table',
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PROVISIONED,
      readCapacity: readCapacity,
      writeCapacity: writeCapacity,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ===========================================
    // Lambda: Writer Function
    // ===========================================
    this.writerFunction = new lambda.Function(this, 'WriterFunction', {
      functionName: 'demo-devops-agent-writer',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'writer.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda'), {
        bundling: {
          image: lambda.Runtime.NODEJS_20_X.bundlingImage,
          command: [
            'bash', '-c', [
              'npm init -y',
              'npm install @aws-sdk/client-dynamodb',
              'cp -r /asset-input/* /asset-output/',
            ].join(' && '),
          ],
        },
      }),
      timeout: cdk.Duration.seconds(60),
      memorySize: 256,
      environment: {
        TABLE_NAME: this.table.tableName,
        WRITE_COUNT: '50',
      },
    });

    // Grant DynamoDB write permissions
    this.table.grantWriteData(this.writerFunction);

    // ===========================================
    // Lambda: Webhook Notifier Function
    // ===========================================
    this.webhookNotifierFunction = new lambda.Function(this, 'WebhookNotifierFunction', {
      functionName: 'demo-devops-agent-webhook-notifier',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'webhook-notifier.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda')),
      timeout: cdk.Duration.seconds(30),
      memorySize: 128,
      environment: {
        WEBHOOK_ENABLED: 'false',
        WEBHOOK_URL: '',
        WEBHOOK_SECRET: '',
        WRITER_LAMBDA_ARN: '', // Will be set after deployment
        DYNAMODB_TABLE_ARN: this.table.tableArn,
      },
    });

    // ===========================================
    // EventBridge Rule: Trigger writer every 1 minute
    // ===========================================
    const scheduleRule = new events.Rule(this, 'ScheduleRule', {
      ruleName: 'demo-devops-agent-schedule',
      schedule: events.Schedule.rate(cdk.Duration.minutes(1)),
      enabled: true,
    });
    scheduleRule.addTarget(new targets.LambdaFunction(this.writerFunction));

    // ===========================================
    // CloudWatch Alarms
    // ===========================================

    // Alarm: DynamoDB Write Throttle Events
    const writeThrottleAlarm = new cloudwatch.Alarm(this, 'WriteThrottleAlarm', {
      alarmName: 'demo-devops-agent-dynamodb-write-throttle',
      alarmDescription: 'DynamoDB write throttling detected - check provisioned WCU',
      metric: this.table.metricThrottledRequestsForOperations({
        operations: [dynamodb.Operation.PUT_ITEM],
        period: cdk.Duration.minutes(1),
        statistic: 'Sum',
      }),
      threshold: 0,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // Alarm: Lambda Errors
    const lambdaErrorAlarm = new cloudwatch.Alarm(this, 'LambdaErrorAlarm', {
      alarmName: 'demo-devops-agent-lambda-errors',
      alarmDescription: 'Lambda function errors detected',
      metric: this.writerFunction.metricErrors({
        period: cdk.Duration.minutes(1),
        statistic: 'Sum',
      }),
      threshold: 0,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // ===========================================
    // Alarm Actions: Invoke Webhook Notifier Lambda
    // ===========================================
    writeThrottleAlarm.addAlarmAction(new actions.LambdaAction(this.webhookNotifierFunction));
    lambdaErrorAlarm.addAlarmAction(new actions.LambdaAction(this.webhookNotifierFunction));

    // ===========================================
    // Outputs
    // ===========================================
    new cdk.CfnOutput(this, 'TableName', {
      value: this.table.tableName,
      description: 'DynamoDB Table Name',
    });

    new cdk.CfnOutput(this, 'TableArn', {
      value: this.table.tableArn,
      description: 'DynamoDB Table ARN',
    });

    new cdk.CfnOutput(this, 'WriterFunctionName', {
      value: this.writerFunction.functionName,
      description: 'Writer Lambda Function Name',
    });

    new cdk.CfnOutput(this, 'WriterFunctionArn', {
      value: this.writerFunction.functionArn,
      description: 'Writer Lambda Function ARN',
    });

    new cdk.CfnOutput(this, 'WebhookNotifierFunctionName', {
      value: this.webhookNotifierFunction.functionName,
      description: 'Webhook Notifier Lambda Function Name',
    });

    new cdk.CfnOutput(this, 'WriteThrottleAlarmArn', {
      value: writeThrottleAlarm.alarmArn,
      description: 'CloudWatch Alarm ARN for DynamoDB Write Throttle',
    });

    new cdk.CfnOutput(this, 'WriteCapacity', {
      value: writeCapacity.toString(),
      description: 'Current DynamoDB Write Capacity Units',
    });

    new cdk.CfnOutput(this, 'ReadCapacity', {
      value: readCapacity.toString(),
      description: 'Current DynamoDB Read Capacity Units',
    });
  }
}
