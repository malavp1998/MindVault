import React, { useState } from 'react';

export default function AIStorePage() {
    const [email, setEmail] = useState('');
    const [subscribed, setSubscribed] = useState(false);

    const handleSubscribe = (e) => {
        e.preventDefault();
        if (email.trim()) {
            setSubscribed(true);
        }
    };

    const agents = [
        {
            title: "Auto Tagger Pro",
            description: "Intelligently re-tags all your notes using advanced topic modeling beyond default AI tags",
            tags: ["Tagging", "Automation"],
            gradient: "linear-gradient(135deg, #3B82F6, #60A5FA)"
        },
        {
            title: "Daily Digest",
            description: "Generates a personalized morning briefing from your vault highlights and due reviews",
            tags: ["Productivity", "Scheduling"],
            gradient: "linear-gradient(135deg, #10B981, #34D399)"
        },
        {
            title: "Link Weaver",
            description: "Scans your vault and surfaces non-obvious connections between unlinked notes",
            tags: ["Graph", "Discovery"],
            gradient: "linear-gradient(135deg, #F59E0B, #FBBF24)"
        },
        {
            title: "Focus Coach",
            description: "Monitors your note-saving patterns and nudges you toward your knowledge gaps",
            tags: ["Learning", "Analytics"],
            gradient: "linear-gradient(135deg, #EC4899, #F472B6)"
        },
        {
            title: "Voice Summarizer",
            description: "Converts long audio recordings into structured vault entries with key takeaways",
            tags: ["Audio", "Capture"],
            gradient: "linear-gradient(135deg, #8B5CF6, #A78BFA)"
        },
        {
            title: "Concept Mapper",
            description: "Builds visual mind maps from any topic cluster in your vault on demand",
            tags: ["Visualization", "Topics"],
            gradient: "linear-gradient(135deg, #06B6D4, #22D3EE)"
        }
    ];

    return (
        <div style={{ padding: '32px 40px', maxWidth: 1200, margin: '0 auto', fontFamily: 'Inter, sans-serif' }}>
            
            {/* Header Section */}
            <div style={{ marginBottom: 32 }}>
                <div>
                    <span style={{ 
                        fontSize: 28, 
                        fontWeight: 700, 
                        background: 'linear-gradient(135deg, #7C3AED, #A855F7)',
                        WebkitBackgroundClip: 'text',
                        WebkitTextFillColor: 'transparent'
                    }}>
                        AI Store
                    </span>
                    <span style={{
                        padding: '3px 10px',
                        background: 'rgba(124,58,237,0.1)',
                        border: '1px solid rgba(124,58,237,0.3)',
                        borderRadius: 20,
                        fontSize: 11,
                        fontWeight: 600,
                        color: '#7C3AED',
                        letterSpacing: 0.5,
                        textTransform: 'uppercase',
                        display: 'inline-flex',
                        verticalAlign: 'middle',
                        marginLeft: 12
                    }}>
                        Coming Soon
                    </span>
                </div>
                <div style={{ fontSize: 15, color: 'var(--text-secondary)', marginTop: 6 }}>
                    Agents and tools built for your second brain
                </div>
            </div>

            {/* Coming Soon Hero Banner */}
            <div style={{
                background: 'linear-gradient(135deg, #1a0a2e 0%, #2d1b69 50%, #1a0a2e 100%)',
                borderRadius: 20,
                padding: '48px 40px',
                textAlign: 'center',
                marginBottom: 48
            }}>
                <div style={{
                    position: 'relative',
                    width: 80,
                    height: 80,
                    margin: '0 auto',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                }}>
                    <div style={{
                        position: 'absolute',
                        inset: 0,
                        border: '2px dashed rgba(167, 139, 250, 0.4)',
                        borderRadius: '50%',
                        animation: 'spin 10s linear infinite'
                    }} />
                    <div style={{
                        width: 50,
                        height: 50,
                        background: 'linear-gradient(135deg, #7C3AED, #C084FC)',
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: '0 0 20px rgba(124,58,237,0.5)'
                    }}>
                        <span style={{ color: 'white', fontSize: 24 }}>🧠</span>
                    </div>
                </div>

                <style>
                    {`@keyframes spin { 100% { transform: rotate(360deg); } }`}
                </style>

                <h2 style={{ fontSize: 24, fontWeight: 700, color: '#fff', marginTop: 20, marginBottom: 12 }}>
                    AI Store — Coming Soon
                </h2>
                
                <p style={{
                    maxWidth: 480,
                    margin: '0 auto',
                    color: '#C4B5FD',
                    fontSize: 15,
                    lineHeight: 1.7
                }}>
                    A marketplace for AI agents purpose-built for MindVault. 
                    Automate your thinking, extend your memory, and supercharge 
                    your second brain with community and official agents.
                </p>

                {subscribed ? (
                    <div style={{ 
                        marginTop: 24, 
                        display: 'inline-flex', 
                        alignItems: 'center', 
                        gap: 8,
                        background: 'rgba(16, 185, 129, 0.1)',
                        border: '1px solid rgba(16, 185, 129, 0.2)',
                        padding: '10px 20px',
                        borderRadius: 10,
                        color: '#34D399',
                        fontWeight: 600,
                        fontSize: 14
                    }}>
                        <span>✨</span> You're on the list!
                    </div>
                ) : (
                    <form onSubmit={handleSubscribe} style={{
                        display: 'flex',
                        gap: 8,
                        maxWidth: 400,
                        margin: '24px auto 0'
                    }}>
                        <input
                            type="email"
                            required
                            placeholder="Enter your email for early access"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            style={{
                                padding: '10px 16px',
                                borderRadius: 10,
                                flex: 1,
                                background: 'rgba(255,255,255,0.08)',
                                border: '1px solid rgba(255,255,255,0.15)',
                                color: '#fff',
                                fontSize: 14,
                                outline: 'none'
                            }}
                        />
                        <button type="submit" style={{
                            padding: '10px 20px',
                            borderRadius: 10,
                            background: 'linear-gradient(135deg, #7C3AED, #A855F7)',
                            color: 'white',
                            fontWeight: 600,
                            fontSize: 14,
                            border: 'none',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6
                        }}>
                            Notify Me
                        </button>
                    </form>
                )}
            </div>

            {/* Preview Agent Cards Grid */}
            <div style={{
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: 1,
                margin: '40px 0 16px'
            }}>
                What's Coming
            </div>

            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
                gap: 16,
                marginBottom: 48
            }}>
                {agents.map((agent, index) => (
                    <div key={index} className="card" style={{
                        background: 'var(--bg-secondary)',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius)',
                        padding: 20,
                        boxShadow: 'var(--shadow-sm)',
                        position: 'relative',
                        overflow: 'hidden',
                        transition: 'all 0.2s ease',
                        cursor: 'default'
                    }}>
                        {/* Coming Soon Ribbon */}
                        <div style={{
                            position: 'absolute',
                            top: 12,
                            right: -2,
                            background: '#7C3AED',
                            color: 'white',
                            fontSize: 10,
                            fontWeight: 700,
                            padding: '3px 10px',
                            letterSpacing: 0.5,
                            borderRadius: '4px 0 0 4px',
                            boxShadow: '-2px 2px 4px rgba(0,0,0,0.1)'
                        }}>
                            COMING SOON
                        </div>

                        {/* Icon Badge */}
                        <div style={{
                            width: 36,
                            height: 36,
                            borderRadius: 8,
                            background: agent.gradient,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: 'white',
                            fontSize: 18,
                            boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
                        }}>
                            🤖
                        </div>

                        <h3 style={{ fontSize: 15, fontWeight: 600, marginTop: 12, marginBottom: 0, color: 'var(--text-primary)' }}>
                            {agent.title}
                        </h3>
                        
                        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 6, lineHeight: 1.5, marginBottom: 16 }}>
                            {agent.description}
                        </p>

                        <div style={{ display: 'flex', gap: 6 }}>
                            {agent.tags.map(tag => (
                                <span key={tag} style={{
                                    background: 'var(--bg-primary)',
                                    border: '1px solid var(--border)',
                                    padding: '2px 8px',
                                    borderRadius: 12,
                                    fontSize: 11,
                                    color: 'var(--text-muted)',
                                    fontWeight: 500
                                }}>
                                    {tag}
                                </span>
                            ))}
                        </div>
                    </div>
                ))}
            </div>

            {/* Contribute Banner */}
            <div style={{
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                padding: '24px 28px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 16
            }}>
                <div>
                    <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                        Build an agent for MindVault
                    </h3>
                    <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4, marginBottom: 0 }}>
                        Open submissions for community-built agents open when the store launches.
                    </p>
                </div>
                
                <button
                    style={{
                        padding: '10px 20px',
                        borderRadius: 10,
                        border: '1px solid rgba(124,58,237,0.4)',
                        background: 'rgba(124,58,237,0.08)',
                        color: '#7C3AED',
                        fontWeight: 600,
                        fontSize: 14,
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                    }}
                    onMouseOver={(e) => e.currentTarget.style.background = 'rgba(124,58,237,0.15)'}
                    onMouseOut={(e) => e.currentTarget.style.background = 'rgba(124,58,237,0.08)'}
                >
                    Join as a Builder
                </button>
            </div>

        </div>
    );
}
