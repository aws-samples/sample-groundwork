/**
 * S3 Document Ingestion Connector
 * 
 * Lists and downloads documents from an S3 bucket, then runs the extraction pipeline.
 * Supports: .txt, .json, .csv, .md files (PDF support requires additional dependency)
 */

import { S3Client, ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { runExtractionPipeline } from "./bedrock-extract";

export interface S3IngestOptions {
  vertical: string;
  bucket: string;
  prefix?: string;          // S3 key prefix (folder)
  maxFiles?: number;        // Limit files to process
  fileTypes?: string[];     // Filter by extension
  region?: string;
}

export interface S3IngestResult {
  files_found: number;
  files_processed: number;
  total_entities: number;
  total_relationships: number;
  errors: string[];
}

export async function ingestFromS3(options: S3IngestOptions): Promise<S3IngestResult> {
  const { vertical, bucket, prefix = "", maxFiles = 20, fileTypes = [".txt", ".json", ".csv", ".md"], region = process.env.AWS_REGION || "us-east-1" } = options;
  const result: S3IngestResult = { files_found: 0, files_processed: 0, total_entities: 0, total_relationships: 0, errors: [] };

  try {
    const client = new S3Client({ region });

    // List objects in bucket
    const listResponse = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      MaxKeys: maxFiles * 2, // Fetch more to filter
    }));

    const objects = (listResponse.Contents || []).filter((obj) => {
      const key = obj.Key || "";
      return fileTypes.some((ext) => key.toLowerCase().endsWith(ext));
    }).slice(0, maxFiles);

    result.files_found = objects.length;

    // Process each file
    for (const obj of objects) {
      const key = obj.Key!;
      try {
        const getResponse = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        const body = await getResponse.Body?.transformToString();
        if (!body) continue;

        const docId = `s3-${key.replace(/[^a-z0-9]/gi, "-").toLowerCase()}`;
        const title = key.split("/").pop() || key;

        const pipelineResult = await runExtractionPipeline(docId, title, `S3: ${bucket}/${key}`, body, vertical);
        result.files_processed++;
        result.total_entities += pipelineResult.entities_extracted;
        result.total_relationships += pipelineResult.relationships_extracted;

        if (pipelineResult.errors.length > 0) {
          result.errors.push(...pipelineResult.errors.map((e) => `${key}: ${e}`));
        }
      } catch (err) {
        result.errors.push(`Failed to process ${key}: ${(err as Error).message}`);
      }
    }
  } catch (err) {
    result.errors.push(`S3 access error: ${(err as Error).message}`);
  }

  return result;
}
