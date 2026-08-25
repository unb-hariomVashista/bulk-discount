import { authenticate } from "../shopify.server";

export const action = async ({ request }) => {
  const { shop, payload, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);
  console.log("Customer data request payload:", payload);

  // Payload includes customer details (id, email, phone) and orders requested.
  // Process data retrieval or compliance reporting if customer data is stored.

  return new Response();
};
