import React from 'react';

const RevisionProgress = ({ streak, current, total, ratings }) => {
    const progressPercent = Math.min(((current) / total) * 100, 100);

    return (
        <div className="mb-10 w-full mt-2">
            <div className="flex justify-between items-end mb-4 px-1">
                <h2 className="text-2xl font-black text-gray-800 dark:text-gray-100 flex items-center gap-3 tracking-tight">
                    <span className="text-3xl">📚</span> Daily Revision
                    {streak > 0 && (
                        <span className="text-sm font-bold bg-orange-100 dark:bg-orange-900/40 text-orange-600 dark:text-orange-400 px-3 py-1 rounded-full shadow-sm ml-2">
                            🔥 {streak} Day Streak
                        </span>
                    )}
                </h2>
                <span className="text-base font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest">
                    {Math.min(current, total)} / {total} done
                </span>
            </div>

            <div className="h-4 w-full bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden flex shadow-inner border border-gray-200/50 dark:border-gray-700/50">
                <div
                    className="h-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 transition-all duration-700 ease-out"
                    style={{ width: `${progressPercent}%` }}
                />
            </div>

            <div className="flex gap-2.5 mt-4 h-3 px-1">
                {ratings.map((rating, idx) => {
                    let bgColor = 'bg-gray-200 dark:bg-gray-700';
                    if (rating === 'forgot') bgColor = 'bg-red-500 shadow-sm shadow-red-500/30';
                    if (rating === 'hard') bgColor = 'bg-orange-500 shadow-sm shadow-orange-500/30';
                    if (rating === 'good') bgColor = 'bg-green-500 shadow-sm shadow-green-500/30';
                    if (rating === 'easy') bgColor = 'bg-purple-500 shadow-sm shadow-purple-500/30';

                    return (
                        <div
                            key={idx}
                            className={`w-3 h-3 rounded-full ${bgColor}`}
                            title={rating}
                        />
                    );
                })}
            </div>
        </div>
    );
};

export default RevisionProgress;
