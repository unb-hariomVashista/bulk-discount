import { redirect, Form, useLoaderData } from "react-router";
import { login, authenticate } from "../../shopify.server";
import styles from "./styles.module.css";

export const loader = async ({ request }) => {
  const url = new URL(request.url);

  // If request contains shopify params, redirect directly to /app dashboard
  if (
    url.searchParams.get("shop") ||
    url.searchParams.get("host") ||
    url.searchParams.get("embedded") ||
    url.searchParams.get("id_token")
  ) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  // Check if session is already authenticated
  try {
    const { session } = await authenticate.admin(request);
    if (session?.shop) {
      throw redirect(`/app?shop=${session.shop}`);
    }
  } catch (err) {
    // If response is a redirect thrown by authenticate.admin, rethrow it
    if (err instanceof Response) throw err;
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>Bulk Discount Codes</h1>
        <p className={styles.text}>
          Create, manage and export thousands of unique discount codes for your store in seconds.
        </p>
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Shop domain</span>
              <input className={styles.input} type="text" name="shop" placeholder="your-store-domain.com" />
              <span>e.g: your-store-domain.com</span>
            </label>
            <button className={styles.button} type="submit">
              Log in to Store
            </button>
          </Form>
        )}
        <ul className={styles.list}>
          <li>
            <strong>Bulk Code Generation</strong>. Generate up to 250,000 unique discount codes with custom prefixes.
          </li>
          <li>
            <strong>Flexible Discount Types</strong>. Support for Fixed Amount, Percentage, Free Shipping, and Buy X Get Y.
          </li>
          <li>
            <strong>Export & Activity Tracking</strong>. Seamlessly export codes to CSV and track usage in real time.
          </li>
        </ul>
      </div>
    </div>
  );
}
