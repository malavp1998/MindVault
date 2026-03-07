import React from 'react';
import { useNavigate } from 'react-router-dom';

const RevisionComplete = ({ streak, total, counts }) => {
    const navigate = useNavigate();

    return (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700/50 p-8 sm:p-12 text-center max-w-2xl mx-auto mt-8 animate-fade-in">
            <div className="text-6xl mb-6 inline-block">🎉</div>
            <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-3">All done!</h2>
            <p className="text-lg text-gray-600 dark:text-gray-400 mb-8">
                You reviewed {total} notes today. Excellent work!
            </p>

            {streak > 0 && (
                <div className="inline-flex items-center justify-center gap-3 bg-gradient-to-r from-orange-400 to-orange-500 text-white px-6 py-3 rounded-2xl shadow-md mb-10 w-full sm:w-auto">
                    <span className="text-3xl">🔥</span>
                    <div className="text-left leading-tight">
                        <div className="text-sm font-semibold opacity-90 uppercase tracking-wide">Current Streak</div>
                        <div className="text-2xl font-bold">{streak} {streak === 1 ? 'Day' : 'Days'}</div>
                    </div>
                </div>
            )}

            <h3 className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-4">Today's Results</h3>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-10">
                <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-100 dark:border-purple-800/50 p-4 rounded-xl">
                    <div className="text-2xl mb-1 text-purple-600 dark:text-purple-400 font-bold">{counts.easy}</div>
                    <div className="text-sm font-medium text-purple-800 dark:text-purple-300">Easy</div>
                </div>
                <div className="bg-green-50 dark:bg-green-900/20 border border-green-100 dark:border-green-800/50 p-4 rounded-xl">
                    <div className="text-2xl mb-1 text-green-600 dark:text-green-400 font-bold">{counts.good}</div>
                    <div className="text-sm font-medium text-green-800 dark:text-green-300">Good</div>
                </div>
                <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-100 dark:border-orange-800/50 p-4 rounded-xl">
                    <div className="text-2xl mb-1 text-orange-600 dark:text-orange-400 font-bold">{counts.hard}</div>
                    <div className="text-sm font-medium text-orange-800 dark:text-orange-300">Hard</div>
                </div>
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800/50 p-4 rounded-xl">
                    <div className="text-2xl mb-1 text-red-600 dark:text-red-400 font-bold">{counts.forgot}</div>
                    <div className="text-sm font-medium text-red-800 dark:text-red-300">Forgot</div>
                </div>
            </div>

            <p className="text-gray-500 dark:text-gray-400 font-medium mb-8">
                Come back tomorrow for your next {total} notes!
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <button
                    onClick={() => navigate('/vault')}
                    className="px-6 py-3 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-white rounded-xl font-semibold transition-colors"
                >
                    Go to Vault
                </button>
                <button
                    onClick={() => navigate('/chat')}
                    className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-semibold transition-colors shadow-sm"
                >
                    Start Chat
                </button>
            </div>
        </div>
    );
};

export default RevisionComplete;
