import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';

const client = new DynamoDBClient({
  maxAttempts: 1, // Disable retry to ensure throttling occurs
});

const TABLE_NAME = process.env.TABLE_NAME!;
const WRITE_COUNT = parseInt(process.env.WRITE_COUNT || '50', 10);

interface WriteResult {
  success: number;
  throttled: number;
  errors: number;
  totalAttempts: number;
}

export const handler = async (): Promise<WriteResult> => {
  console.log(`Starting write operation: ${WRITE_COUNT} items to ${TABLE_NAME}`);
  console.log(`Timestamp: ${new Date().toISOString()}`);

  const results: WriteResult = {
    success: 0,
    throttled: 0,
    errors: 0,
    totalAttempts: WRITE_COUNT,
  };

  const batchId = `batch-${Date.now()}`;

  // Execute writes in parallel to maximize throttling chance
  const promises = Array.from({ length: WRITE_COUNT }, async (_, i) => {
    const item = {
      pk: { S: batchId },
      sk: { S: `item-${i.toString().padStart(4, '0')}-${randomId()}` },
      data: { S: 'x'.repeat(900) }, // ~1KB per item
      timestamp: { S: new Date().toISOString() },
      batchId: { S: batchId },
      itemIndex: { N: i.toString() },
    };

    try {
      await client.send(
        new PutItemCommand({
          TableName: TABLE_NAME,
          Item: item,
        })
      );
      results.success++;
    } catch (error: unknown) {
      const err = error as Error & { name?: string };
      if (err.name === 'ProvisionedThroughputExceededException') {
        console.error(`THROTTLED: Item ${i} - ${err.message}`);
        results.throttled++;
      } else {
        console.error(`ERROR: Item ${i} - ${err.name}: ${err.message}`);
        results.errors++;
      }
    }
  });

  await Promise.all(promises);

  console.log(`Results: ${JSON.stringify(results)}`);
  console.log(
    `Summary: ${results.success} success, ${results.throttled} throttled, ${results.errors} errors`
  );

  // Throw error if throttling occurred to trigger CloudWatch alarm
  if (results.throttled > 0) {
    const errorMessage = `Throttling occurred: ${results.throttled}/${results.totalAttempts} requests were throttled`;
    console.error(errorMessage);
    throw new Error(errorMessage);
  }

  return results;
};

function randomId(): string {
  return Math.random().toString(36).substring(2, 15);
}
