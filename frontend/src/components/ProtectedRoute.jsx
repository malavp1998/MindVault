import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function ProtectedRoute({ children }) {
    const { user, loading } = useAuth();

    if (loading) {
        return (
            <div className="auth-loading-screen">
                <div className="auth-loading-spinner"></div>
                <p>Loading MindVault...</p>
            </div>
        );
    }

    if (!user) return <Navigate to="/login" replace />;

    return children;
}
