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
        <div className="bg-white dark:bg-[#1A1A2E] rounded-3xl shadow-xl shadow-indigo-100/50 dark:shadow-none border border-gray-100 dark:border-gray-800 p-8 sm:p-12 transition-all relative overflow-hidden" style={{ minHeight: '400px', display: 'flex', flexDirection: 'column' }}>
            {/* Top Meta */}
            <div className="flex justify-between items-start mb-8">
                <div className="flex-1 pr-6">
                    <span className="text-sm font-bold text-indigo-500 uppercase tracking-widest mb-2 block">
                        Note {currentIdx + 1} of {total}
                    </span>
                    <h3 className="text-3xl font-extrabold text-gray-900 dark:text-white mt-1 leading-snug tracking-tight">
                        {note.title}
                    </h3>
                    <div className="flex gap-2 flex-wrap mt-5">
                        {[...(note.user_tags || []), ...(note.auto_tags || [])].slice(0, 4).map(t => (
                            <span key={t} className="px-3 py-1.5 bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300 text-xs rounded-full font-bold uppercase tracking-wide">
                                {t}
                            </span>
                        ))}
                    </div>
                </div>

                {/* Retention Badge */}
                <div className="flex items-center gap-2.5 bg-white dark:bg-gray-800 shadow-sm border border-gray-100 dark:border-gray-700 px-4 py-2 rounded-full cursor-default shrink-0" title={`Estimated memory retention: ${retentionPct}%`}>
                    <div className={`w-3 h-3 rounded-full shadow-inner ${retentionColor}`} />
                    <span className="text-sm font-bold text-gray-700 dark:text-gray-300">
                        {retentionPct}%
                    </span>
                </div>
            </div>

            {!revealed && (
                <div className="flex-1 flex flex-col justify-center items-center mt-12 mb-8 animate-fade-in">
                    <button
                        onClick={() => setRevealed(true)}
                        className="flex items-center gap-3 px-10 py-4 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white rounded-2xl font-bold shadow-lg hover:shadow-xl transition-all hover:-translate-y-1 focus:ring-4 focus:ring-indigo-500/30 text-lg"
                    >
                        <span className="text-2xl">👁</span>
                        Reveal Summary
                    </button>
                    <p className="mt-6 text-gray-400 dark:text-gray-500 text-sm font-medium">Try to recall the contents before revealing.</p>
                </div>
            )}

            {revealed && (
                <div className="mt-8 pt-8 border-t border-gray-100 dark:border-gray-700/50 animate-fade-in flex-1 flex flex-col">
                    <div className="mb-10">
                        <h4 className="text-xs font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-4">AI Insight</h4>
                        <div className="prose prose-base dark:prose-invert max-w-none text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800/50 p-6 sm:p-8 rounded-2xl border border-gray-100 dark:border-gray-700/50 leading-relaxed">
                            <ReactMarkdown>{note.summary || "No summary available."}</ReactMarkdown>
                        </div>
                    </div>

                    <div className="mt-auto">
                        {!rated ? (
                            <div className="animate-fade-in-up bg-white dark:bg-[#1A1A2E]">
                                <p className="text-center font-bold text-gray-800 dark:text-gray-200 mb-6 text-lg">
                                    How easily did you recall this?
                                </p>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 max-w-3xl mx-auto">
                                    <button onClick={() => handleRateClick('forgot')} className="py-5 px-2 rounded-2xl border-2 border-red-100 bg-white hover:bg-red-50 hover:border-red-200 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-red-900/20 dark:hover:border-red-800/50 transition-all text-center group shadow-sm">
                                        <div className="text-4xl mb-2 group-hover:scale-110 transition-transform">😰</div>
                                        <div className="font-extrabold text-red-600 dark:text-red-400 text-sm uppercase tracking-wide">Forgot</div>
                                    </button>
                                    <button onClick={() => handleRateClick('hard')} className="py-5 px-2 rounded-2xl border-2 border-orange-100 bg-white hover:bg-orange-50 hover:border-orange-200 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-orange-900/20 dark:hover:border-orange-800/50 transition-all text-center group shadow-sm">
                                        <div className="text-4xl mb-2 group-hover:scale-110 transition-transform">😐</div>
                                        <div className="font-extrabold text-orange-600 dark:text-orange-400 text-sm uppercase tracking-wide">Hard</div>
                                    </button>
                                    <button onClick={() => handleRateClick('good')} className="py-5 px-2 rounded-2xl border-2 border-green-100 bg-white hover:bg-green-50 hover:border-green-200 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-green-900/20 dark:hover:border-green-800/50 transition-all text-center group shadow-sm">
                                        <div className="text-4xl mb-2 group-hover:scale-110 transition-transform">🙂</div>
                                        <div className="font-extrabold text-green-600 dark:text-green-400 text-sm uppercase tracking-wide">Good</div>
                                    </button>
                                    <button onClick={() => handleRateClick('easy')} className="py-5 px-2 rounded-2xl border-2 border-purple-100 bg-white hover:bg-purple-50 hover:border-purple-200 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-purple-900/20 dark:hover:border-purple-800/50 transition-all text-center group shadow-sm">
                                        <div className="text-4xl mb-2 group-hover:scale-110 transition-transform">😎</div>
                                        <div className="font-extrabold text-purple-600 dark:text-purple-400 text-sm uppercase tracking-wide">Easy</div>
                                    </button>
                                </div>

                                <div className="flex justify-center mt-8">
                                    <button onClick={() => onSkip(note.id)} className="text-sm font-bold text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 transition-colors px-4 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800">
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
                </div>
            )}
        </div>
    );
};

export default RevisionCard;
