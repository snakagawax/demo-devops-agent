import * as crypto from 'crypto';
import * as https from 'https';
import * as url from 'url';

// Environment variables
const WEBHOOK_ENABLED = process.env.WEBHOOK_ENABLED === 'true';
const WEBHOOK_URL = process.env.WEBHOOK_URL || '';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';
const SERVICE_NAME = process.env.SERVICE_NAME || 'DemoDevOpsAgent';

// CloudWatch Alarm event structure
interface CloudWatchAlarmEvent {
  source: string;
  alarmArn: string;
  accountId: string;
  time: string;
  region: string;
  alarmData: {
    alarmName: string;
    state: {
      value: string;
      reason: string;
      reasonData?: string;
      timestamp: string;
    };
    previousState: {
      value: string;
      reason: string;
      timestamp: string;
    };
    configuration: {
      description?: string;
      metrics?: Array<{
        id: string;
        metricStat?: {
          metric: {
            namespace: string;
            name: string;
            dimensions?: Record<string, string>;
          };
          period: number;
          stat: string;
        };
      }>;
    };
  };
}

// DevOps Agent webhook payload structure (公式ドキュメント準拠)
interface DevOpsAgentWebhookPayload {
  eventType: string;
  incidentId: string;
  action: string;
  priority: string;
  title: string;
  description: string;
  service: string;
  timestamp: string;
  data: {
    metadata: {
      region: string;
      environment: string;
      affectedResources: string[];
      alarmName: string;
      alarmArn: string;
      accountId: string;
    };
  };
}

export const handler = async (event: CloudWatchAlarmEvent): Promise<void> => {
  console.log('Received CloudWatch Alarm event:', JSON.stringify(event, null, 2));

  const alarmName = event.alarmData?.alarmName || 'Unknown Alarm';
  const alarmState = event.alarmData?.state?.value || 'UNKNOWN';
  const stateReason = event.alarmData?.state?.reason || 'No reason provided';
  const timestamp = event.alarmData?.state?.timestamp || new Date().toISOString();
  const accountId = event.accountId || 'unknown';
  const region = event.region || 'us-east-1';
  const alarmArn = event.alarmArn || '';

  console.log(`Alarm: ${alarmName}`);
  console.log(`State: ${alarmState}`);
  console.log(`Reason: ${stateReason}`);

  // Only process ALARM state
  if (alarmState !== 'ALARM') {
    console.log(`Skipping non-ALARM state: ${alarmState}`);
    return;
  }

  // Check if webhook is enabled
  if (!WEBHOOK_ENABLED) {
    console.log('Webhook is DISABLED (WEBHOOK_ENABLED=false)');
    console.log('To enable, set WEBHOOK_ENABLED=true and configure WEBHOOK_URL and WEBHOOK_SECRET');
    console.log('Would have sent webhook with payload:');
    const dryRunPayload = buildWebhookPayload(alarmName, stateReason, timestamp, region, accountId, alarmArn);
    console.log(JSON.stringify(dryRunPayload, null, 2));
    return;
  }

  // Validate webhook configuration
  if (!WEBHOOK_URL) {
    console.error('WEBHOOK_URL is not configured');
    throw new Error('WEBHOOK_URL is required when WEBHOOK_ENABLED=true');
  }

  if (!WEBHOOK_SECRET) {
    console.error('WEBHOOK_SECRET is not configured');
    throw new Error('WEBHOOK_SECRET is required when WEBHOOK_ENABLED=true');
  }

  // Build and send webhook
  const payload = buildWebhookPayload(alarmName, stateReason, timestamp, region, accountId, alarmArn);
  console.log('Sending webhook payload:', JSON.stringify(payload, null, 2));

  await sendWebhook(payload);
  console.log('Webhook sent successfully to DevOps Agent');
};

function buildWebhookPayload(
  alarmName: string,
  stateReason: string,
  timestamp: string,
  region: string,
  accountId: string,
  alarmArn: string
): DevOpsAgentWebhookPayload {
  const incidentId = `${alarmName.replace(/\s+/g, '-')}-${Date.now()}`;

  // Build affected resources list from alarm ARN
  const affectedResources: string[] = alarmArn ? [alarmArn] : [];

  return {
    eventType: 'incident',
    incidentId,
    action: 'created',
    priority: 'HIGH',
    title: `[CloudWatch Alarm] ${alarmName}`,
    description: stateReason,
    service: SERVICE_NAME,
    timestamp,
    data: {
      metadata: {
        region,
        environment: 'production',
        affectedResources,
        alarmName,
        alarmArn,
        accountId,
      },
    },
  };
}

async function sendWebhook(payload: DevOpsAgentWebhookPayload): Promise<void> {
  const payloadString = JSON.stringify(payload);
  const timestamp = new Date().toISOString();

  // Generate HMAC-SHA256 signature
  const hmac = crypto.createHmac('sha256', WEBHOOK_SECRET);
  hmac.update(`${timestamp}:${payloadString}`, 'utf8');
  const signature = hmac.digest('base64');

  const parsedUrl = new url.URL(WEBHOOK_URL);

  const options: https.RequestOptions = {
    hostname: parsedUrl.hostname,
    port: parsedUrl.port || 443,
    path: parsedUrl.pathname + parsedUrl.search,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payloadString),
      'x-amzn-event-timestamp': timestamp,
      'x-amzn-event-signature': signature,
    },
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let responseBody = '';
      res.on('data', (chunk) => {
        responseBody += chunk;
      });
      res.on('end', () => {
        console.log(`Webhook response status: ${res.statusCode}`);
        console.log(`Webhook response body: ${responseBody}`);

        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve();
        } else {
          reject(new Error(`Webhook failed with status ${res.statusCode}: ${responseBody}`));
        }
      });
    });

    req.on('error', (error) => {
      console.error('Webhook request error:', error);
      reject(error);
    });

    req.write(payloadString);
    req.end();
  });
}
