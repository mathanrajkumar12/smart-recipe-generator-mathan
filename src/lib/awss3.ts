import * as https from 'https';
import { Transform as Stream } from 'stream';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { StreamingBlobPayloadInputTypes } from '@smithy/types';
import { UploadReturnType } from '../types';

interface UploadToS3Type {
  originalImgLink: string | undefined;
  userId: string | undefined;
  location: string;
}

/**
 * Convert image from URL to buffer with automatic retry (3x)
 * Handles ENOTFOUND and temporary network failures gracefully.
 */
export const processImage = async (
  url: string,
  retries = 3,
  delay = 1500
): Promise<StreamingBlobPayloadInputTypes> => {
  return new Promise((resolve, reject) => {
    const attempt = (n: number) => {
      const request = https.request(url, (response) => {
        const data: Uint8Array[] = [];

        response.on('data', (chunk) => data.push(chunk));
        response.on('end', () => {
          if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
            resolve(Buffer.concat(data));
          } else if (n > 0) {
            console.warn(`Retrying image download... (${3 - n + 1}) for ${url}`);
            setTimeout(() => attempt(n - 1), delay);
          } else {
            console.error(`❌ Failed to fetch image after retries: ${url}`);
            reject(new Error(`Image download failed. Status: ${response.statusCode}`));
          }
        });
      });

      request.on('error', (err) => {
        if (n > 0) {
          console.warn(`⚠️ Retrying due to error: ${err.message} (${3 - n + 1})`);
          setTimeout(() => attempt(n - 1), delay);
        } else {
          console.error(`❌ Failed to fetch image from ${url}: ${err.message}`);
          reject(err);
        }
      });

      request.end();
    };

    attempt(retries);
  });
};

// Configure S3 client (uses correct region + endpoint)
export const configureS3 = () =>
  process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
    ? new S3Client({
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
        },
        region: process.env.AWS_REGION || 'us-east-2', // ✅ use Ohio
        endpoint: process.env.S3_ENDPOINT || 'https://s3.us-east-2.amazonaws.com',
      })
    : null;

// Upload one image (with fallback skip on network errors)
export const uploadImageToS3 = async ({
  originalImgLink,
  userId,
  location,
}: UploadToS3Type): Promise<UploadReturnType> => {
  try {
    if (!originalImgLink) throw new Error("Image link is undefined");
    const s3 = configureS3();
    if (!s3) throw new Error("Unable to configure S3");

    // Try to download image from OpenAI URL
    const Body = await processImage(originalImgLink);

    const command = new PutObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME!,
      Key: location,
      Body,
      ContentType: "image/png",
      ACL: "public-read",
      Tagging: `userId=${userId}`,
      CacheControl: "public, max-age=2592000",
    });

    await s3.send(command);
    console.log(`Uploaded image successfully -> ${location}`);
    return { location, uploaded: true };
  } catch (error: any) {
    // 🚨 If it's a network issue, skip gracefully instead of failing
    if (error.code === "ENOTFOUND" || error.message?.includes("ENOTFOUND")) {
      console.warn(`⚠️ Skipping image upload due to network issue: ${error.message}`);
      return { location, uploaded: false };
    }

    // Any other error is logged but not fatal
    console.error(` Error uploading image: ${originalImgLink?.slice(0, 50)}... - ${error}`);
    return { location, uploaded: false };
  }
};


// Upload multiple images
export const uploadImagesToS3 = async (
  openaiImagesArray: UploadToS3Type[],
): Promise<UploadReturnType[] | null> => {
  try {
    const results = await Promise.all(openaiImagesArray.map(uploadImageToS3));
    return results;
  } catch (error) {
    console.error(error);
    return null;
  }
};

// ✅ Upload audio (auto region + bucket)
export const uploadAudioToS3 = async ({
  audioBuffer,
  fileName,
}: {
  audioBuffer: Buffer;
  fileName: string;
}): Promise<string> => {
  try {
    const s3 = configureS3();
    if (!s3) throw new Error('Unable to configure S3');

    const command = new PutObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME!,
      Key: `audio/${fileName}`,
      Body: audioBuffer,
      ContentType: 'audio/mpeg',
      CacheControl: 'public, max-age=2592000',
      ACL: 'public-read',
    });

    await s3.send(command);

    // ✅ use dynamic region in URL
    const s3Url = `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/audio/${fileName}`;
    console.log(`🎵 Uploaded audio to S3 -> ${s3Url}`);
    return s3Url;
  } catch (error) {
    console.error(`Error uploading audio to S3. File: ${fileName} - ${error}`);
    throw new Error(`Failed to upload audio to S3: ${error}`);
  }
};
