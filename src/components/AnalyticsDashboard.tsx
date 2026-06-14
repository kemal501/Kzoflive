import React, { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { motion } from 'motion/react';

interface AnalyticsData {
  time: string;
  viewers: number;
}

const AnalyticsDashboard: React.FC = () => {
  const [data, setData] = useState<AnalyticsData[]>([]);

  useEffect(() => {
    const interval = setInterval(() => {
      const now = new Date();
      const time = `${now.getHours()}:${now.getMinutes()}:${now.getSeconds()}`;
      setData(prev => {
        const newData = [...prev, { time, viewers: Math.floor(Math.random() * 100) }];
        return newData.slice(-20); // Keep last 20 points
      });
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-slate-800 p-6 rounded-lg shadow-xl w-full max-w-4xl mt-8"
    >
      <h2 className="text-2xl font-bold text-white mb-6">Stream Analytics</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-slate-700 p-4 rounded-lg">
          <p className="text-slate-400 text-sm">Current Viewers</p>
          <p className="text-3xl font-bold text-white">{data[data.length - 1]?.viewers || 0}</p>
        </div>
        <div className="bg-slate-700 p-4 rounded-lg">
          <p className="text-slate-400 text-sm">Avg Watch Time</p>
          <p className="text-3xl font-bold text-white">4.2 min</p>
        </div>
        <div className="bg-slate-700 p-4 rounded-lg">
          <p className="text-slate-400 text-sm">Engagement Rate</p>
          <p className="text-3xl font-bold text-white">12.5%</p>
        </div>
      </div>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#475569" />
            <XAxis dataKey="time" stroke="#94a3b8" />
            <YAxis stroke="#94a3b8" />
            <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: 'none' }} />
            <Line type="monotone" dataKey="viewers" stroke="#3b82f6" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </motion.div>
  );
};

export default AnalyticsDashboard;
