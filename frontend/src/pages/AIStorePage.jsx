import React, { useState } from 'react';
import { ShoppingBag, Sparkles, Send, Zap, Activity, Layers, Brain, Mic, PanelsTopLeft, Cpu } from 'lucide-react';

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
            icon: <Zap size={20} strokeWidth={2} />,
            color: "rgb(59, 130, 246)",
            bgColor: "rgba(59, 130, 246, 0.082)"
        },
        {
            title: "Daily Digest",
            description: "Generates a personalized morning briefing from your vault highlights and due reviews",
            tags: ["Productivity", "Scheduling"],
            icon: <Activity size={20} strokeWidth={2} />,
            color: "rgb(16, 185, 129)",
            bgColor: "rgba(16, 185, 129, 0.082)"
        },
        {
            title: "Link Weaver",
            description: "Scans your vault and surfaces non-obvious connections between unlinked notes",
            tags: ["Graph", "Discovery"],
            icon: <Layers size={20} strokeWidth={2} />,
            color: "rgb(245, 158, 11)",
            bgColor: "rgba(245, 158, 11, 0.082)"
        },
        {
            title: "Focus Coach",
            description: "Monitors your note-saving patterns and nudges you toward your knowledge gaps",
            tags: ["Learning", "Analytics"],
            icon: <Brain size={20} strokeWidth={2} />,
            color: "rgb(236, 72, 153)",
            bgColor: "rgba(236, 72, 153, 0.082)"
        },
        {
            title: "Voice Summarizer",
            description: "Converts long audio recordings into structured vault entries with key takeaways",
            tags: ["Audio", "Capture"],
            icon: <Mic size={20} strokeWidth={2} />,
            color: "rgb(139, 92, 246)",
            bgColor: "rgba(139, 92, 246, 0.082)"
        },
        {
            title: "Concept Mapper",
            description: "Builds visual mind maps from any topic cluster in your vault on demand",
            tags: ["Visualization", "Topics"],
            icon: <PanelsTopLeft size={20} strokeWidth={2} />,
            color: "rgb(6, 182, 212)",
            bgColor: "rgba(6, 182, 212, 0.082)"
        }
    ];

    return (
        <div style={{ padding: '64px 40px', maxWidth: 1000, margin: '0px auto' }}>
            {/* Header Section */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 48 }}>
                <div style={{ width: 56, height: 56, borderRadius: 16, background: 'var(--accent-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)' }}>
                    <ShoppingBag size={28} strokeWidth={2} />
                </div>
                <div>
                    <h1 style={{ fontSize: '2.5rem', color: 'var(--text-dark)', margin: 0 }}>
                        <span className="page-header-serif" style={{ fontSize: 'inherit' }}>ai</span>
                        <span className="page-header-title" style={{ fontSize: 'inherit', fontWeight: 700 }}> store</span>
                    </h1>
                    <p style={{ color: 'var(--text-muted)', fontSize: '1rem', marginTop: 4 }}>
                        Agents and tools built for your second brain
                    </p>
                </div>
            </div>

            {/* Coming Soon Hero Banner */}
            <div style={{
                background: 'linear-gradient(135deg, rgb(26, 26, 26), rgb(45, 45, 45))',
                borderRadius: 24,
                padding: 64,
                textAlign: 'center',
                color: 'rgb(255, 255, 255)',
                marginBottom: 64,
                boxShadow: 'rgba(0, 0, 0, 0.1) 0px 24px 48px',
                position: 'relative',
                overflow: 'hidden'
            }}>
                <div style={{
                    position: 'absolute',
                    top: -100,
                    right: -100,
                    width: 300,
                    height: 300,
                    borderRadius: '50%',
                    background: 'var(--accent)',
                    filter: 'blur(100px)',
                    opacity: 0.2
                }} />
                
                <div style={{
                    display: 'inline-flex',
                    padding: '8px 16px',
                    borderRadius: 24,
                    background: 'rgba(255, 255, 255, 0.1)',
                    fontSize: '0.875rem',
                    fontWeight: 600,
                    marginBottom: 24,
                    gap: 8,
                    alignItems: 'center'
                }}>
                    <Sparkles size={16} stroke="var(--accent)" strokeWidth={2} />
                    Marketplace Launching Soon
                </div>

                <h2 style={{ fontSize: '2.5rem', fontWeight: 700, marginBottom: 16 }}>
                    Supercharge your memory
                </h2>
                
                <p style={{
                    fontSize: '1.1rem',
                    color: 'rgba(255, 255, 255, 0.7)',
                    maxWidth: 600,
                    margin: '0px auto 40px',
                    lineHeight: 1.6
                }}>
                    Directly connect world-class AI agents to your personal knowledge base. Automate re-tagging, generate daily digests, and discover hidden connections.
                </p>

                {subscribed ? (
                    <div style={{ 
                        display: 'inline-flex',
                        background: 'rgba(16, 185, 129, 0.1)',
                        border: '1px solid rgba(16, 185, 129, 0.2)',
                        padding: '12px 24px',
                        borderRadius: 12,
                        color: '#34D399',
                        fontWeight: 600,
                        fontSize: 16
                    }}>
                        Thanks! We'll notify you when we launch.
                    </div>
                ) : (
                    <form onSubmit={handleSubscribe} style={{
                        display: 'flex',
                        gap: 12,
                        maxWidth: 440,
                        margin: '0px auto',
                        background: 'rgba(255, 255, 255, 0.05)',
                        padding: 8,
                        borderRadius: 16,
                        border: '1px solid rgba(255, 255, 255, 0.1)'
                    }}>
                        <input
                            required
                            placeholder="Enter your email"
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            style={{
                                flex: 1,
                                background: 'none',
                                border: 'none',
                                color: 'rgb(255, 255, 255)',
                                padding: '0px 16px',
                                outline: 'none',
                                fontSize: '1rem'
                            }}
                        />
                        <button type="submit" style={{
                            padding: '12px 24px',
                            background: 'var(--accent)',
                            color: 'rgb(255, 255, 255)',
                            border: 'none',
                            borderRadius: 12,
                            fontWeight: 600,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8
                        }}>
                            Notify Me <Send size={16} strokeWidth={2} />
                        </button>
                    </form>
                )}
            </div>

            {/* Preview Agent Cards Grid */}
            <h3 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: 24, color: 'var(--text-dark)' }}>
                Coming to the store
            </h3>

            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                gap: 24,
                marginBottom: 64
            }}>
                {agents.map((agent, index) => (
                    <div key={index} style={{
                        background: 'rgb(255, 255, 255)',
                        border: '1px solid var(--border)',
                        borderRadius: 20,
                        padding: 24,
                        transition: '0.3s'
                    }}>
                        {/* Icon Badge */}
                        <div style={{
                            width: 40,
                            height: 40,
                            borderRadius: 10,
                            background: agent.bgColor,
                            color: agent.color,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            marginBottom: 20
                        }}>
                            {agent.icon}
                        </div>

                        <h4 style={{ fontSize: '1rem', fontWeight: 600, margin: '0px 0px 8px', color: 'var(--text-dark)' }}>
                            {agent.title}
                        </h4>
                        
                        <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 20 }}>
                            {agent.description}
                        </p>

                        <div style={{ display: 'flex', gap: 8 }}>
                            {agent.tags.map(tag => (
                                <span key={tag} style={{
                                    fontSize: '0.75rem',
                                    padding: '4px 8px',
                                    borderRadius: 12,
                                    background: 'var(--bg)',
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
                background: 'var(--bg)',
                border: '1px solid var(--border)',
                borderRadius: 24,
                padding: 32,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 24
            }}>
                <div>
                    <h4 style={{ fontSize: '1.1rem', fontWeight: 600, margin: 0, color: 'var(--text-dark)' }}>
                        Are you a builder?
                    </h4>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: '4px 0px 0px' }}>
                        Request early access to our Agent SDK and build for the MindVault community.
                    </p>
                </div>
                
                <button
                    style={{
                        padding: '12px 24px',
                        border: '1px solid var(--border)',
                        borderRadius: 12,
                        background: 'rgb(255, 255, 255)',
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        color: 'var(--text-dark)'
                    }}
                >
                    <Cpu size={18} strokeWidth={2} />
                    Apply for SDK
                </button>
            </div>
        </div>
    );
}
