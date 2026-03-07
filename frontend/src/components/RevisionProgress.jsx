import React from 'react';

const RevisionProgress = ({ streak, current, total, ratings }) => {
    const progressPercent = Math.min(((current) / total) * 100, 100);

    return (
        <div className="mb-6">
            <div className="flex justify-between items-center mb-2">
                <h2 className="text-xl font-bold dark:text-gray-100 flex items-center gap-2">
                    📚 Daily Revision
                    {streak > 0 && (
                        <span className="text-sm font-medium bg-orange-100 dark:bg-orange-900/40 text-orange-600 dark:text-orange-400 px-2 py-0.5 rounded-full">
                            🔥 {streak}
                        </span>
                    )}
                </h2>
                <span className="text-sm font-medium text-gray-500 dark:text-gray-400">
                    {Math.min(current, total)}/{total} done
                </span>
            </div>

            <div className="h-2 w-full bg-gray-200 dark:bg-gray-700/50 rounded-full overflow-hidden flex">
                <div
                    className="h-full bg-gradient-to-r from-purple-500 to-indigo-500 transition-all duration-500 ease-out"
                    style={{ width: `${progressPercent}%` }}
                />
            </div>

            <div className="flex gap-2 mt-3 h-3">
                {ratings.map((rating, idx) => {
                    let bgColor = 'bg-gray-300 dark:bg-gray-600';
                    if (rating === 'forgot') bgColor = 'bg-red-500';
                    if (rating === 'hard') bgColor = 'bg-orange-500';
                    if (rating === 'good') bgColor = 'bg-green-500';
                    if (rating === 'easy') bgColor = 'bg-purple-400';

                    return (
                        <div
                            key={idx}
                            className={`w-3 h-3 rounded-full shadow-sm ${bgColor} bg-opacity-90`}
                            title={rating}
                        />
                    );
                })}
            </div>
        </div>
    );
};

export default RevisionProgress;
