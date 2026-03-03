import axios from 'axios';

export const api = axios.create({
    baseURL: '/api',
    timeout: 120000,
});

// Attach JWT token to every request automatically
api.interceptors.request.use(config => {
    const token = localStorage.getItem('mv_token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

// Redirect to login if token expired (401)
api.interceptors.response.use(
    response => response,
    error => {
        if (error.response?.status === 401) {
            localStorage.removeItem('mv_token');
            window.location.href = '/login';
        }
        return Promise.reject(error);
    }
);

// ─── Notes ─────────────────────────────────────────────────────

export const createNote = (data) =>
    api.post('/notes', data).then(r => r.data);

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

export default api;
