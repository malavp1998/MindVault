import axios from "axios";
import { auth } from "./firebase";

const API_URL = import.meta.env.VITE_API_URL || "";
export const api = axios.create({ baseURL: `${API_URL}/api` });

api.interceptors.request.use(async (config) => {
    if (auth.currentUser) {
        const token = await auth.currentUser.getIdToken();
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

// ─── Notes ─────────────────────────────────────────────────────

export const createNote = (data) =>
    api.post('/notes', data).then(r => r.data);

export const createAudioNote = (formData) =>
    api.post('/notes/audio', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
    }).then(r => r.data);

export const listNotes = (params = {}) =>
    api.get('/notes', { params }).then(r => r.data);

export const getNote = (id) =>
    api.get(`/notes/${id}`).then(r => r.data);

export const deleteNote = (id) =>
    api.delete(`/notes/${id}`);

export const processNote = (id) =>
    api.post(`/notes/${id}/process`).then(r => r.data);

export const searchNotes = (q, { topK = 10, synthesize = false } = {}) =>
    api.get('/notes/search', {
        params: { q, top_k: topK, synthesize },
    }).then(r => r.data);

export const getRelatedNotes = (params) =>
    api.get('/notes/related', { params }).then(r => r.data);

// ─── Topics ────────────────────────────────────────────────────

export const listTopics = () =>
    api.get('/topics').then(r => r.data);

export const getTopic = (id) =>
    api.get(`/topics/${id}`).then(r => r.data);

export const summarizeTopic = (id) =>
    api.post(`/topics/${id}/summarize`).then(r => r.data);

// ─── Chat ──────────────────────────────────────────────────────

export const getChatSessions = () =>
    api.get('/chat/sessions').then(r => r.data);

export const getChatMessages = (sessionId) =>
    api.get(`/chat/sessions/${sessionId}/messages`).then(r => r.data);

export const sendChatMessage = (message, sessionId = null) =>
    api.post('/chat/message', { message, session_id: sessionId }).then(r => r.data);

export const deleteChatSession = (sessionId) =>
    api.delete(`/chat/sessions/${sessionId}`);

export default api;
