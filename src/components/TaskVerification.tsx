import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { doc, getDoc, updateDoc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { Task } from '../services/taskService';
import { CheckCircle, AlertCircle } from 'lucide-react';

interface Props {
  task: Task;
  userId: string;
  onVerified: (verified: boolean) => void;
}

export const TaskVerification: React.FC<Props> = ({ task, userId, onVerified }) => {
  const [completed, setCompleted] = useState(false);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    const progressRef = doc(db, 'userTasks', `${userId}_${task.id}`);
    const unsubscribe = onSnapshot(progressRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        setCompleted(data.completed || false);
        onVerified(data.completed || false);
      }
    });
    return () => unsubscribe();
  }, [task.id, userId, onVerified]);

  const handleVerify = async () => {
    setVerifying(true);
    // Simulate verification action
    await new Promise((resolve) => setTimeout(resolve, 1500));
    
    // In a real app, this would verify the actual task action.
    // Here we just mark it as completed in Firestore.                
    const progressRef = doc(db, 'userTasks', `${userId}_${task.id}`);
    await updateDoc(progressRef, { completed: true });                
    
    setVerifying(false);
  };

  return (
    <div className="p-4 bg-slate-800 rounded-xl border border-slate-700">
      <h3 className="text-sm font-bold text-white mb-2">Task Verification</h3>
      <p className="text-xs text-slate-400 mb-4">{task.description}</p>
      
      {completed ? (
        <div className="flex items-center gap-2 text-green-400 text-sm font-bold">
          <CheckCircle size={16} />
          <span>Task Verified! You can now claim your reward.</span>
        </div>
      ) : (
        <button
          onClick={handleVerify}
          disabled={verifying}
          className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-bold disabled:opacity-50"
        >
          {verifying ? 'Verifying...' : 'Click to Verify Action'}
        </button>
      )}
    </div>
  );
};
