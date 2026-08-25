import { authenticate } from "../shopify.server";

export const action = async ({ request }) => {
  const { shop, payload, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);
  console.log("Customer redact payload:", payload);

  // Customer redact payload includes customer details to erase/anonymize.
  // Purge any stored PII associated with customer if stored locally.

  return new Response();
};
