import { useLoaderData, useNavigate } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  Activity,
  PlusCircle,
  Trash2,
  TrendingUp,
  Download,
  ShieldCheck,
  Clock,
} from "lucide-react";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  let logs = [];
  try {
    if (db.activityLog) {
      logs = await db.activityLog.findMany({
        where: { shop },
        orderBy: { createdAt: "desc" },
        take: 100,
      });
    }
  } catch (e) {
    console.error("activityLog loader error:", e?.message || e);
  }

  return { logs };
};

export default function ActivityLogsPage() {
  const { logs } = useLoaderData();
  const navigate = useNavigate();

  const getActionBadge = (action) => {
    switch (action) {
      case "CAMPAIGN_CREATED":
        return {
          label: "Campaign Created",
          bg: "#dcfce7",
          color: "#15803d",
          icon: <PlusCircle size={14} />,
        };
      case "CAMPAIGN_DELETED":
        return {
          label: "Campaign Deleted",
          bg: "#fee2e2",
          color: "#b91c1c",
          icon: <Trash2 size={14} />,
        };
      case "PLAN_UPGRADED":
        return {
          label: "Plan Changed",
          bg: "#dbeafe",
          color: "#1d4ed8",
          icon: <TrendingUp size={14} />,
        };
      case "CODES_EXPORTED":
        return {
          label: "Codes Exported",
          bg: "#fef3c7",
          color: "#b45309",
          icon: <Download size={14} />,
        };
      default:
        return {
          label: action,
          bg: "#f3f4f6",
          color: "#4b5563",
          icon: <Activity size={14} />,
        };
    }
  };

  return (
    <div className="bd-dashboard">
      <div className="bd-max-width">
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: "24px", fontWeight: 700 }}>Activity Logs</h1>
            <p style={{ margin: "4px 0 0 0", color: "#616161", fontSize: "14px" }}>
              Audit trail of all discount code generation, exports, and store actions.
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "#166534", background: "#dcfce7", padding: "8px 14px", borderRadius: "8px", fontSize: "13px", fontWeight: 600 }}>
            <ShieldCheck size={18} />
            <span>Audit Trail Enabled</span>
          </div>
        </div>

        {/* Activity Table Card */}
        <div className="bd-table-card">
          <div className="bd-table-wrapper">
            <table className="bd-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Action</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                {logs.length === 0 ? (
                  <tr>
                    <td colSpan={3} style={{ textAlign: "center", padding: "40px", color: "#616161" }}>
                      No activity recorded yet. Create a campaign to start logging!
                    </td>
                  </tr>
                ) : (
                  logs.map((log) => {
                    const badge = getActionBadge(log.action);
                    return (
                      <tr key={log.id}>
                        <td style={{ width: "200px", color: "#616161", fontSize: "13px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            <Clock size={14} />
                            {new Date(log.createdAt).toLocaleString()}
                          </div>
                        </td>
                        <td style={{ width: "180px" }}>
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "6px",
                              backgroundColor: badge.bg,
                              color: badge.color,
                              padding: "4px 10px",
                              borderRadius: "12px",
                              fontSize: "12px",
                              fontWeight: 600,
                            }}
                          >
                            {badge.icon}
                            {badge.label}
                          </span>
                        </td>
                        <td style={{ fontWeight: 500, fontSize: "14px", color: "#1a1a1a" }}>
                          {log.description}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
