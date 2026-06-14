import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, addDoc, serverTimestamp, query, orderBy } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { Link, useNavigate } from 'react-router-dom';
import { getUserProfile, User } from '../services/userService';
import { User as UserIcon, Mic, Headphones } from 'lucide-react';

interface Room {
  id: string;
  name: string;
  topic: string;
  hostId: string;
  createdAt: any;
  speakers?: Record<string, any>;
  listeners?: Record<string, any>;
}

const VoiceRoomsList: React.FC = () => {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [hostProfiles, setHostProfiles] = useState<Record<string, User>>({});
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    if (!auth.currentUser) {
      setRooms([]);
      return;
    }

    const q = query(collection(db, 'voiceRooms'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const roomsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Room[];
      setRooms(roomsData);

      // Fetch host profiles
      roomsData.forEach(async (room) => {
        if (room.hostId && !hostProfiles[room.hostId]) {
          const profile = await getUserProfile(room.hostId);
          if (profile) {
            setHostProfiles(prev => ({ ...prev, [room.hostId]: profile }));
          }
        }
      });
    }, (error) => {
      if (error.code === 'permission-denied') {
        console.log("Permission denied for voiceRooms list. User might be unauthenticated.");
      } else {
        console.error("Error in voiceRooms list snapshot:", error);
      }
    });
    return () => unsubscribe();
  }, [auth.currentUser]);

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser) {
      alert("Please log in to create a room.");
      return;
    }
    try {
      const docRef = await addDoc(collection(db, 'voiceRooms'), {
        name,
        topic,
        hostId: auth.currentUser.uid,
        createdAt: serverTimestamp(),
        speakers: {},
        listeners: {}
      });
      navigate(`/rooms/${docRef.id}`);
    } catch (error) {
      console.error("Error creating room:", error);
    }
  };

  return (
    <div className="p-4 max-w-4xl mx-auto w-full">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">Voice Discussion Rooms</h2>
        <button 
          onClick={() => setShowCreate(!showCreate)}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded font-semibold"
        >
          {showCreate ? 'Cancel' : 'Create Room'}
        </button>
      </div>

      {showCreate && (
        <form onSubmit={handleCreateRoom} className="bg-slate-800 p-4 rounded-lg mb-6 shadow-md">
          <div className="mb-4">
            <label className="block text-sm font-medium text-slate-300 mb-1">Room Name</label>
            <input 
              type="text" 
              required
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded p-2 text-white"
              placeholder="e.g., Tech Talk"
            />
          </div>
          <div className="mb-4">
            <label className="block text-sm font-medium text-slate-300 mb-1">Topic</label>
            <input 
              type="text" 
              required
              value={topic}
              onChange={e => setTopic(e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded p-2 text-white"
              placeholder="What are we discussing?"
            />
          </div>
          <button type="submit" className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded font-semibold w-full">
            Start Room
          </button>
        </form>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {rooms.map(room => {
          const speakersCount = room.speakers ? Object.keys(room.speakers).length : 0;
          const listenersCount = room.listeners ? Object.keys(room.listeners).length : 0;
          const host = hostProfiles[room.hostId];
          
          return (
            <Link 
              key={room.id} 
              to={`/rooms/${room.id}`}
              className="bg-slate-800 p-5 rounded-3xl hover:bg-slate-700 transition-all border border-slate-700 hover:border-blue-500/50 block relative overflow-hidden group shadow-xl"
            >
              {/* Owner Box in the right corner */}
              <div className="absolute top-0 right-0 p-3 flex flex-col items-end">
                <div className="bg-slate-900/80 backdrop-blur-md p-1.5 rounded-2xl border border-slate-700 flex items-center gap-2 shadow-lg group-hover:border-blue-500/30 transition-colors">
                  <div className="flex flex-col items-end">
                    <span className="text-[8px] text-slate-500 font-black uppercase tracking-widest leading-none">Owner</span>
                    <span className="text-[10px] text-white font-bold truncate max-w-[60px]">{host?.userName || 'Host'}</span>
                  </div>
                  {host?.photoURL ? (
                    <img src={host.photoURL} alt="Owner" className="w-8 h-8 rounded-xl object-cover border border-blue-500/30" />
                  ) : (
                    <div className="w-8 h-8 bg-blue-600 rounded-xl flex items-center justify-center text-white">
                      <UserIcon size={16} />
                    </div>
                  )}
                </div>
              </div>

              <div className="pr-16">
                <h3 className="text-xl font-black text-white group-hover:text-blue-400 transition-colors tracking-tight">{room.name}</h3>
                <p className="text-slate-400 mt-1 text-sm font-medium line-clamp-1">{room.topic}</p>
              </div>

              <div className="flex gap-4 mt-6">
                <div className="flex items-center gap-1.5 bg-blue-600/10 text-blue-400 px-3 py-1 rounded-full text-[10px] font-black uppercase border border-blue-500/20">
                  <Mic size={12} />
                  <span>{speakersCount}/24 Speakers</span>
                </div>
                <div className="flex items-center gap-1.5 bg-emerald-600/10 text-emerald-400 px-3 py-1 rounded-full text-[10px] font-black uppercase border border-emerald-500/20">
                  <Headphones size={12} />
                  <span>{listenersCount} Listeners</span>
                </div>
              </div>

              {/* Decorative background */}
              <div className="absolute -bottom-10 -right-10 w-32 h-32 bg-blue-600/5 rounded-full blur-2xl group-hover:bg-blue-600/10 transition-colors"></div>
            </Link>
          );
        })}
        {rooms.length === 0 && !showCreate && (
          <p className="text-slate-400 col-span-full text-center py-8">No active rooms. Be the first to create one!</p>
        )}
      </div>
    </div>
  );
};

export default VoiceRoomsList;
