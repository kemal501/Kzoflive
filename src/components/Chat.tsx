import React, { useState, useEffect, useRef } from 'react';
import { collection, addDoc, query, orderBy, onSnapshot, serverTimestamp, deleteDoc, doc } from 'firebase/firestore';
import { signInWithPopup } from 'firebase/auth';
import { db, auth, googleProvider } from '../firebase';
import { getUserProfile, User, followUser, unfollowUser, getFollowingList } from '../services/userService';
import { MessageSquare } from 'lucide-react';
import GiftPanel from './GiftPanel';

interface Message {
  id: string;
  text: string;
  userId: string;
  userName: string;
  gifterLevel?: number;
  createdAt: any;
}

interface ChatProps {
  roomId: string;
  isHost?: boolean;
  className?: string;
}

const Chat: React.FC<ChatProps> = ({ roomId, isHost, className }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [currentUserProfile, setCurrentUserProfile] = useState<User | null>(null);
  const [followingList, setFollowingList] = useState<string[]>([]);
  const [mutedUsers, setMutedUsers] = useState<string[]>([]);
  const [bannedUsers, setBannedUsers] = useState<string[]>([]);
  const [showGiftPanel, setShowGiftPanel] = useState<string | null>(null); // userId to gift
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let unsubscribeSnapshot: () => void;
    let unsubscribeMuted: () => void;
    let unsubscribeBanned: () => void;

    const unsubscribeAuth = auth.onAuthStateChanged(async (user) => {
      if (unsubscribeSnapshot) unsubscribeSnapshot();
      if (unsubscribeMuted) unsubscribeMuted();
      if (unsubscribeBanned) unsubscribeBanned();

      if (user) {
        const profile = await getUserProfile(user.uid);
        setCurrentUserProfile(profile);
        
        const following = await getFollowingList(user.uid);
        setFollowingList(following);

        const q = query(collection(db, 'rooms', roomId, 'chat'), orderBy('createdAt', 'asc'));
        unsubscribeSnapshot = onSnapshot(q, (snapshot) => {
          const msgs: Message[] = [];
          snapshot.forEach((doc) => {
            msgs.push({ id: doc.id, ...doc.data() } as Message);
          });
          setMessages(msgs);
        }, (error) => {
          if (error.code === 'permission-denied') {
            console.log("Permission denied for chat messages. User might be unauthenticated or banned.");
          } else {
            console.error("Error in chat messages snapshot:", error);
          }
        });

        unsubscribeMuted = onSnapshot(collection(db, 'rooms', roomId, 'muted'), (snapshot) => {
          setMutedUsers(snapshot.docs.map(doc => doc.data().userId));
        }, (error) => {
          if (error.code !== 'permission-denied') {
            console.error("Error in muted users snapshot:", error);
          }
        });

        unsubscribeBanned = onSnapshot(collection(db, 'rooms', roomId, 'banned'), (snapshot) => {
          setBannedUsers(snapshot.docs.map(doc => doc.data().userId));
        }, (error) => {
          if (error.code !== 'permission-denied') {
            console.error("Error in banned users snapshot:", error);
          }
        });
      } else {
        setMessages([]);
        setCurrentUserProfile(null);
        setFollowingList([]);
        setMutedUsers([]);
        setBannedUsers([]);
      }
    });

    return () => {
      if (unsubscribeSnapshot) unsubscribeSnapshot();
      if (unsubscribeMuted) unsubscribeMuted();
      if (unsubscribeBanned) unsubscribeBanned();
      unsubscribeAuth();
    };
  }, [roomId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const canModerate = isHost || (currentUserProfile && (currentUserProfile.role === 'admin' || currentUserProfile.role === 'moderator'));

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser || !newMessage.trim()) return;

    if (mutedUsers.includes(auth.currentUser.uid)) {
      alert("You are muted.");
      return;
    }
    if (bannedUsers.includes(auth.currentUser.uid)) {
      alert("You are banned.");
      return;
    }

    await addDoc(collection(db, 'rooms', roomId, 'chat'), {
      text: newMessage,
      userId: auth.currentUser.uid,
      userName: auth.currentUser.displayName || 'Anonymous',
      gifterLevel: currentUserProfile?.gifterLevel || 0,
      createdAt: serverTimestamp(),
    });
    setNewMessage('');
  };

  const deleteMessage = async (messageId: string) => {
    if (!canModerate) return;
    try {
      await deleteDoc(doc(db, 'rooms', roomId, 'chat', messageId));
    } catch (err) {
      console.error("Error deleting message:", err);
    }
  };

  const muteUser = async (userId: string) => {
    if (!canModerate) return;
    await addDoc(collection(db, 'rooms', roomId, 'muted'), { 
      userId,
      mutedBy: auth.currentUser?.uid,
      createdAt: serverTimestamp()
    });
  };

  const unmuteUser = async (userId: string) => {
    if (!canModerate) return;
    const q = query(collection(db, 'rooms', roomId, 'muted'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (s) => {
      s.docs.forEach(async (d) => {
        if (d.data().userId === userId) {
          await deleteDoc(doc(db, 'rooms', roomId, 'muted', d.id));
        }
      });
      unsubscribe();
    });
  };

  const banUser = async (userId: string) => {
    if (!canModerate) return;
    await addDoc(collection(db, 'rooms', roomId, 'banned'), { 
      userId,
      bannedBy: auth.currentUser?.uid,
      createdAt: serverTimestamp()
    });
  };

  const handleFollowToggle = async (targetUserId: string) => {
    if (!auth.currentUser || targetUserId === auth.currentUser.uid) return;
    
    const isFollowing = followingList.includes(targetUserId);
    try {
      if (isFollowing) {
        await unfollowUser(auth.currentUser.uid, targetUserId);
        setFollowingList(prev => prev.filter(id => id !== targetUserId));
      } else {
        await followUser(auth.currentUser.uid, targetUserId);
        setFollowingList(prev => [...prev, targetUserId]);
      }
    } catch (error) {
      console.error("Error toggling follow:", error);
    }
  };

  const signIn = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error: any) {
      if (error && error.code === 'auth/popup-closed-by-user') {
        console.log("Chat sign-in popup closed by user.");
      } else {
        console.error("Chat sign-in error:", error);
      }
    }
  };

  return (
    <div className={className || "bg-slate-800 p-4 rounded-lg shadow-xl w-full max-w-md mt-8 flex flex-col h-[400px]"}>
      <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
        <MessageSquare size={20} className="text-blue-400" />
        Live Chat
      </h2>
      {auth.currentUser ? (
        <>
          <div className="flex-1 overflow-y-auto mb-4 pr-2">
            <div className="mb-4 p-2 bg-slate-700/50 rounded flex flex-col gap-1">
              <div className="flex justify-between items-center">
                <span className="text-sm text-slate-300">Your Balance: <span className="text-yellow-500 font-bold">{currentUserProfile?.coins || 0} 🪙</span></span>
                <button 
                  onClick={() => setShowGiftPanel(auth.currentUser?.uid || null)}
                  className="text-xs bg-pink-600 hover:bg-pink-700 text-white px-2 py-1 rounded font-bold transition-colors"
                >
                  🎁 Gift Self
                </button>
              </div>
              {currentUserProfile?.gifterLevel !== undefined && (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-400 uppercase font-bold">Gifter Level:</span>
                  <span className="bg-gradient-to-r from-yellow-400 to-orange-500 text-white text-[10px] px-2 py-0.5 rounded-full font-black shadow-sm">
                    LVL {currentUserProfile.gifterLevel}
                  </span>
                  <div className="flex-1 h-1 bg-slate-800 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-yellow-500" 
                      style={{ width: `${Math.min(100, ((currentUserProfile.totalSpent || 0) % 1000) / 10)}%` }}
                    ></div>
                  </div>
                </div>
              )}
            </div>
            {messages.map((msg) => (
              <div key={msg.id} className="mb-2 group flex justify-between items-start">
                <div className="flex-1">
                  {msg.gifterLevel && msg.gifterLevel > 0 && (
                    <span className="bg-gradient-to-r from-yellow-400 to-orange-500 text-white text-[10px] px-1.5 py-0.5 rounded-full font-black mr-1 shadow-sm">
                      LVL {msg.gifterLevel}
                    </span>
                  )}
                  <span className="font-bold text-blue-400 mr-1 cursor-pointer hover:underline" onClick={() => setShowGiftPanel(msg.userId)}>{msg.userName}</span>
                  {msg.userId !== auth.currentUser?.uid && (
                    <button 
                      onClick={() => handleFollowToggle(msg.userId)}
                      className={`text-xs px-1.5 py-0.5 rounded mr-2 ${followingList.includes(msg.userId) ? 'bg-slate-600 text-slate-300' : 'bg-blue-600 text-white'}`}
                    >
                      {followingList.includes(msg.userId) ? 'Following' : 'Follow'}
                    </button>
                  )}
                  <span className="text-white">: {msg.text}</span>
                </div>
                <div className="flex gap-1 items-center">
                  <button 
                    onClick={() => setShowGiftPanel(msg.userId)}
                    className="opacity-0 group-hover:opacity-100 text-pink-500 text-xs hover:text-pink-400 transition-opacity mr-2"
                    title="Send Gift"
                  >
                    🎁
                  </button>
                  {canModerate && (
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => deleteMessage(msg.id)} className="text-red-500 text-[10px] hover:text-red-400 font-bold" title="Delete Message">DEL</button>
                      {mutedUsers.includes(msg.userId) ? (
                        <button onClick={() => unmuteUser(msg.userId)} className="text-green-500 text-[10px] hover:text-green-400 font-bold" title="Unmute User">UNMUTE</button>
                      ) : (
                        <button onClick={() => muteUser(msg.userId)} className="text-yellow-500 text-[10px] hover:text-yellow-400 font-bold" title="Mute User">MUTE</button>
                      )}
                      {!bannedUsers.includes(msg.userId) && (
                        <button onClick={() => banUser(msg.userId)} className="text-red-700 text-[10px] hover:text-red-600 font-bold" title="Ban User">BAN</button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {showGiftPanel && (
            <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setShowGiftPanel(null)}>
              <div onClick={e => e.stopPropagation()}>
                <GiftPanel 
                  receiverId={showGiftPanel} 
                  roomId={roomId} 
                  onGiftSent={() => setShowGiftPanel(null)} 
                />
                <button 
                  onClick={() => setShowGiftPanel(null)}
                  className="mt-2 w-full bg-slate-700 text-white py-2 rounded hover:bg-slate-600 font-bold"
                >
                  Close
                </button>
              </div>
            </div>
          )}
          <form onSubmit={sendMessage} className="flex gap-2">
            <input
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              className="flex-1 bg-slate-700 p-2 rounded text-white"
              placeholder="Type a message..."
            />
            <button type="submit" className="bg-blue-600 px-4 py-2 rounded text-white font-bold">Send</button>
          </form>
        </>
      ) : (
        <button onClick={signIn} className="bg-blue-600 p-4 rounded text-white font-bold">Sign in with Google to Chat</button>
      )}
    </div>
  );
};

export default Chat;
