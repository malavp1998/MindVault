import { useState } from "react";
import { api } from "../api";

export default function ConfirmationCard({ action, onResolved }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const handleDecision = async (approved) => {
    setLoading(true);
    try {
      const res = await api.post(
        `/agent/confirm/${action.token}?approved=${approved}`,
        {}
      );
      setResult({ approved, message: res.data.message });
      onResolved(approved, res.data.message);
    } catch (err) {
      setResult({ approved: false, message: "Something went wrong." });
    } finally {
      setLoading(false);
    }
  };

  if (result) {
    return (
      <div className={`confirmation-result ${result.approved ? "success" : "denied"}`}>
        {result.approved ? "✓" : "✗"} {result.message}
      </div>
    );
  }

  return (
    <div className="confirmation-card">
      {/* Header */}
      <div className="confirmation-header">
        <span className="confirmation-icon">⚠️</span>
        <p className="confirmation-message">{action.message}</p>
      </div>

      {/* Diff Preview */}
      {action.diff && (
        <div className="diff-container">
          {action.diff.before && (
            <div className="diff-before">
              <span className="diff-label">Before</span>
              <pre>{action.diff.before}</pre>
            </div>
          )}
          {action.diff.after && (
            <div className="diff-after">
              <span className="diff-label">After</span>
              <pre>{action.diff.after}</pre>
            </div>
          )}
          {!action.diff.after && (
            <div className="diff-delete-warning">
              This note will be permanently deleted.
            </div>
          )}
        </div>
      )}

      {/* Allow / Deny buttons */}
      <div className="confirmation-actions">
        <button
          className="btn-allow"
          onClick={() => handleDecision(true)}
          disabled={loading}
        >
          {loading ? "Applying..." : "✓ Allow"}
        </button>
        <button
          className="btn-deny"
          onClick={() => handleDecision(false)}
          disabled={loading}
        >
          ✗ Deny
        </button>
      </div>
    </div>
  );
}
