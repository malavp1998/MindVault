require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/mindvault'
});

async function main() {
    try {
        const userId = '1';
        
        await pool.query(`
            INSERT INTO users (id, email, name, password_hash) 
            VALUES ($1, 'demo@example.com', 'Demo User', 'dummy')
            ON CONFLICT (id) DO NOTHING;
        `, [userId]);
        
        await pool.query(`
            INSERT INTO notes (id, user_id, title, content, summary, is_processed, url, domain, source_type, created_at, updated_at) 
            VALUES 
            (gen_random_uuid(), $1, 'Artificial Intelligence in 2024', 'This is a long content about AI. It includes many details about transformers, diffusion models, and RLHF.', 'A summary about AI advancements.', true, 'https://example.com/ai', 'example.com', 'web', NOW(), NOW()),
            (gen_random_uuid(), $1, 'React Server Components', 'React Server Components allow you to render components on the server, reducing the JavaScript bundle size sent to the client. This improves performance and SEO.', 'Quick overview of RSCs.', true, 'https://react.dev/rsc', 'react.dev', 'web', NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day')
        `, [userId]);
        
        console.log("Mock notes injected successfully.");
    } catch (e) {
        console.error("Error setting up mock data:", e);
    } finally {
        await pool.end();
    }
}
main();
