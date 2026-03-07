import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';

const RevisionCard = ({ note, total, currentIdx, onRate, onSkip, rateResult }) => {
    const [revealed, setRevealed] = useState(false);
    const [rated, setRated] = useState(false);
    const [ratingVal, setRatingVal] = useState(null);

    const getRetentionColor = (pct) => {
        if (pct >= 0.70) return 'bg-green-500';
        if (pct >= 0.40) return 'bg-orange-500';
        return 'bg-red-500';
    };

    const retentionPct = Math.round(note.estimated_retention * 100);
    const retentionColor = getRetentionColor(note.estimated_retention);

    const handleRateClick = (val) => {
        setRated(true);
        setRatingVal(val);
        onRate(note.id, val);
    };

    return (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700/50 p-6 sm:p-8 transition-all relative overflow-hidden">
            {/* Top Meta */}
            <div className="flex justify-between items-start mb-6">
                <div>
                    <span className="text-sm font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                        Note {currentIdx + 1} of {total}
                    </span>
                    <h3 className="text-2xl font-bold text-gray-900 dark:text-white mt-1 leading-tight">
                        {note.title}
                    </h3>
                    <div className="flex gap-2 flex-wrap mt-3">
                        {[...(note.user_tags || []), ...(note.auto_tags || [])].slice(0, 4).map(t => (
                            <span key={t} className="px-2.5 py-1 bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400 text-xs rounded-full font-medium">
                                #{t}
                            </span>
                        ))}
                    </div>
                </div>

                {/* Retention Badge */}
                <div className="flex items-center gap-2 bg-gray-50 dark:bg-gray-700/30 px-3 py-1.5 rounded-full border border-gray-100 dark:border-gray-600/50 cursor-default" title={`Estimated memory retention: ${retentionPct}%`}>
                    <div className={`w-2.5 h-2.5 rounded-full ${retentionColor}`} />
                    <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                        {retentionPct}%
                    </span>
                </div>
            </div>

            {!revealed && (
                <div className="flex justify-center mt-10 mb-4">
                    <button
                        onClick={() => setRevealed(true)}
                        className="flex items-center gap-2 px-8 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-semibold shadow-sm transition-all focus:ring-4 focus:ring-indigo-500/30"
                    >
                        <span className="text-xl">👁</span>
                        Show Summary
                    </button>
                </div>
            )}

            {revealed && (
                <div className="mt-8 pt-6 border-t border-gray-100 dark:border-gray-700 animate-fade-in">
                    <div className="mb-8">
                        <h4 className="text-sm font-bold text-indigo-500 uppercase tracking-wider mb-3">AI Summary</h4>
                        <div className="prose prose-sm dark:prose-invert max-w-none text-gray-700 dark:text-gray-300 bg-indigo-50/50 dark:bg-indigo-900/10 p-5 rounded-xl border border-indigo-100 dark:border-indigo-800/30">
                            <ReactMarkdown>{note.summary || "No summary available."}</ReactMarkdown>
                        </div>
                    </div>

                    {!rated ? (
                        <div className="animate-fade-in-up">
                            <p className="text-center font-semibold text-gray-700 dark:text-gray-300 mb-4">
                                How well did you recall this?
                            </p>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-3xl mx-auto">
                                <button onClick={() => handleRateClick('forgot')} className="p-4 rounded-xl border-2 border-red-200 bg-red-50 hover:bg-red-100 dark:border-red-900/50 dark:bg-red-900/20 dark:hover:bg-red-900/40 transition-colors text-center group">
                                    <div className="text-3xl mb-1 group-hover:scale-110 transition-transform">😰</div>
                                    <div className="font-bold text-red-700 dark:text-red-400">Forgot</div>
                                </button>
                                <button onClick={() => handleRateClick('hard')} className="p-4 rounded-xl border-2 border-orange-200 bg-orange-50 hover:bg-orange-100 dark:border-orange-900/50 dark:bg-orange-900/20 dark:hover:bg-orange-900/40 transition-colors text-center group">
                                    <div className="text-3xl mb-1 group-hover:scale-110 transition-transform">😐</div>
                                    <div className="font-bold text-orange-700 dark:text-orange-400">Hard</div>
                                </button>
                                <button onClick={() => handleRateClick('good')} className="p-4 rounded-xl border-2 border-green-200 bg-green-50 hover:bg-green-100 dark:border-green-900/50 dark:bg-green-900/20 dark:hover:bg-green-900/40 transition-colors text-center group">
                                    <div className="text-3xl mb-1 group-hover:scale-110 transition-transform">🙂</div>
                                    <div className="font-bold text-green-700 dark:text-green-400">Good</div>
                                </button>
                                <button onClick={() => handleRateClick('easy')} className="p-4 rounded-xl border-2 border-purple-200 bg-purple-50 hover:bg-purple-100 dark:border-purple-900/50 dark:bg-purple-900/20 dark:hover:bg-purple-900/40 transition-colors text-center group">
                                    <div className="text-3xl mb-1 group-hover:scale-110 transition-transform">😊</div>
                                    <div className="font-bold text-purple-700 dark:text-purple-400">Easy</div>
                                </button>
                            </div>

                            <div className="flex justify-center mt-6">
                                <button onClick={() => onSkip(note.id)} className="text-sm font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 underline underline-offset-4 decoration-gray-300 dark:decoration-gray-600 transition-colors">
                                    Skip for now
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="text-center py-6 animate-fade-in">
                            <div className="text-5xl mb-4">
                                {ratingVal === 'forgot' && '😰'}
                                {ratingVal === 'hard' && '😐'}
                                {ratingVal === 'good' && '🙂'}
                                {ratingVal === 'easy' && '😊'}
                            </div>

                            {rateResult ? (
                                <div className="space-y-2">
                                    <p className="font-bold text-lg text-gray-800 dark:text-gray-200">
                                        {rateResult.message}
                                    </p>
                                    <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
                                        Next review in {rateResult.new_interval} days
                                    </p>
                                    {rateResult.is_mastered && (
                                        <span className="mt-2 inline-block px-3 py-1 bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-400 rounded-full font-bold text-sm">
                                            🏆 Mastered!
                                        </span>
                                    )}
                                </div>
                            ) : (
                                <div className="flex justify-center mt-4">
                                    <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default RevisionCard;
