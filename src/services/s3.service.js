/**
 * S3 storage service for the graphics library.
 *
 * Handles upload, delete, and signed-URL generation for library assets.
 * Credentials are resolved automatically by the AWS SDK (env vars, IAM role, etc.).
 */

const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { S3_BUCKET, S3_REGION, S3_PREFIX } = require('../config/constants');

let client = null;

function getClient() {
  if (!client) {
    client = new S3Client({ region: S3_REGION });
  }
  return client;
}

/**
 * Upload a file buffer to S3.
 *
 * @param {string} key       - File name (without prefix).
 * @param {Buffer} buffer    - File contents.
 * @param {string} contentType - MIME type.
 * @returns {Promise<string>} The full S3 key (prefix + key).
 */
async function uploadFile(key, buffer, contentType) {
  const fullKey = S3_PREFIX + key;

  await getClient().send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: fullKey,
    Body: buffer,
    ContentType: contentType,
  }));

  return fullKey;
}

/**
 * Delete a file from S3.
 *
 * @param {string} s3Key - The full S3 key (including prefix).
 */
async function deleteFile(s3Key) {
  await getClient().send(new DeleteObjectCommand({
    Bucket: S3_BUCKET,
    Key: s3Key,
  }));
}

/**
 * Generate a presigned GET URL for an S3 object.
 *
 * @param {string} s3Key      - The full S3 key.
 * @param {number} [expiresIn=86400] - URL expiry in seconds (default 24h).
 * @returns {Promise<string>}
 */
async function getPresignedUrl(s3Key, expiresIn = 86400) {
  const command = new GetObjectCommand({
    Bucket: S3_BUCKET,
    Key: s3Key,
  });
  return getSignedUrl(getClient(), command, { expiresIn });
}

/**
 * Fetch a file from S3 and return the response body stream + content info.
 *
 * @param {string} s3Key - The full S3 key.
 * @returns {Promise<{ body: ReadableStream, contentType: string, contentLength: number }>}
 */
async function getFileStream(s3Key) {
  const command = new GetObjectCommand({
    Bucket: S3_BUCKET,
    Key: s3Key,
  });
  const response = await getClient().send(command);
  return {
    body: response.Body,
    contentType: response.ContentType,
    contentLength: response.ContentLength,
  };
}

/**
 * Check if S3 is configured (bucket name is set).
 */
function isConfigured() {
  return !!S3_BUCKET;
}

module.exports = {
  uploadFile,
  deleteFile,
  getPresignedUrl,
  getFileStream,
  isConfigured,
};
