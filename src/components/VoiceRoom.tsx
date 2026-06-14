import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, onSnapshot, updateDoc, deleteField, getDoc, collection, addDoc, serverTimestamp, query, orderBy, limit, increment } from 'firebase/firestore';
import { db, auth } from '../firebase';
import Peer, { MediaConnection } from 'peerjs';
import Chat from './Chat';
import { User, getUserProfile } from '../services/userService';
import { triggerImpact, triggerNotification } from '../utils/haptic';

interface RoomData {
  name: string;
  topic: string;
  hostId: string;
  speakers: Record<string, { seatIndex: number; isMuted: boolean; peerId: string; userName: string }>;
  listeners: Record<string, { peerId: string; userName: string }>;
  musicUrl?: string | null;
  isMusicPlaying?: boolean;
  maxSeats?: number;
}

const VideoElement: React.FC<{ stream: MediaStream; muted?: boolean; className?: string }> = ({ stream, muted, className }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);
  return <video ref={videoRef} autoPlay muted={muted} playsInline className={className || "w-12 h-12 rounded-full object-cover"} />;
};

const playSound = (type: 'click' | 'start' | 'stop' | 'join' | 'leave') => {
  const AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!AudioContext) return;
  const ctx = new AudioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.connect(gain);
  gain.connect(ctx.destination);

  const now = ctx.currentTime;

  if (type === 'join') {
    osc.type = 'sine';
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.linearRampToValueAtTime(880, now + 0.1);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.2, now + 0.05);
    gain.gain.linearRampToValueAtTime(0, now + 0.2);
    osc.start(now);
    osc.stop(now + 0.2);
  } else if (type === 'leave') {
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.linearRampToValueAtTime(440, now + 0.1);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.2, now + 0.05);
    gain.gain.linearRampToValueAtTime(0, now + 0.2);
    osc.start(now);
    osc.stop(now + 0.2);
  } else {
    // Existing sounds...
    if (type === 'click') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(800, now);
      osc.frequency.exponentialRampToValueAtTime(1200, now + 0.05);
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.05);
      osc.start(now);
      osc.stop(now + 0.05);
    } else if (type === 'start') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.setValueAtTime(660, now + 0.1);
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.1, now + 0.05);
      gain.gain.linearRampToValueAtTime(0, now + 0.3);
      osc.start(now);
      osc.stop(now + 0.3);
    } else if (type === 'stop') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(660, now);
      osc.frequency.setValueAtTime(440, now + 0.1);
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.1, now + 0.05);
      gain.gain.linearRampToValueAtTime(0, now + 0.3);
      osc.start(now);
      osc.stop(now + 0.3);
    }
  }
};

const VoiceRoom: React.FC = () => {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const currentUser = auth.currentUser;
  const [room, setRoom] = useState<RoomData | null>(null);
  const prevRoomRef = useRef<RoomData | null>(null);
  const [peer, setPeer] = useState<Peer | null>(null);
  const [myPeerId, setMyPeerId] = useState<string | null>(null);
  const [myStream, setMyStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [isMuted, setIsMuted] = useState(false);
  const [error] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [reactions, setReactions] = useState<Array<{ id: string; emoji: string; userId: string; timestamp: any }>>([]);
  const [showChat, setShowChat] = useState(true);
  const [transcription, setTranscription] = useState<string>('');
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [editName, setEditName] = useState('');
  const [editTopic, setEditTopic] = useState('');
  const [musicUrl, setMusicUrl] = useState<string | null>(null);
  const [isPlayingMusic, setIsPlayingMusic] = useState(false);
  const musicAudioRef = useRef<HTMLAudioElement | null>(null);
  const musicSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const audioDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const recognitionRef = useRef<any>(null);
  
  const [hostProfiles, setHostProfiles] = useState<Record<string, User>>({});
  
  // Custom states added for Barca-live update
  const [toast, setToast] = useState<string | null>(null);
  const showToast = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 2500);
  };
  
  const [activePanel, setActivePanel] = useState<'controlPanel' | 'musicPanel' | 'gamesPanel' | 'taskPanel' | null>(null);
  const [userCoins, setUserCoins] = useState<number>(0);
  const [userPoints] = useState<number>(320);
  const [newUserDays, setNewUserDays] = useState<number>(0);
  const [oldDone, setOldDone] = useState<boolean>(false);
  const [roomSeconds, setRoomSeconds] = useState<number>(0);
  const [withdrawAccount, setWithdrawAccount] = useState<string>('');
  const [speakingSeats, setSpeakingSeats] = useState<Record<number, boolean>>({});
  const [myProfile, setMyProfile] = useState<User | null>(null);
  const [speakerProfiles, setSpeakerProfiles] = useState<Record<string, User>>({});

  useEffect(() => {
    if (room?.hostId && !hostProfiles[room.hostId]) {
      getUserProfile(room.hostId).then(profile => {
        if (profile) setHostProfiles(prev => ({ ...prev, [room.hostId]: profile }));
      });
    }
  }, [room?.hostId]);

  useEffect(() => {
    if (room?.speakers) {
      Object.keys(room.speakers).forEach(uid => {
        if (!speakerProfiles[uid]) {
          getUserProfile(uid).then(profile => {
            if (profile) setSpeakerProfiles(prev => ({ ...prev, [uid]: profile }));
          });
        }
      });
    }
  }, [room?.speakers]);

  useEffect(() => {
    if (currentUser) {
      const userDocRef = doc(db, 'users', currentUser.uid);
      const unsubscribe = onSnapshot(userDocRef, (docSnap) => {
        if (docSnap.exists()) {
          const profileData = docSnap.data() as User;
          setMyProfile(profileData);
          setUserCoins(profileData.coins || 0);
        }
      }, (err) => {
        console.log("Error loading current user profile:", err);
      });
      return () => unsubscribe();
    }
  }, [currentUser]);

  // Read state from localStorage
  useEffect(() => {
    const savedCoins = localStorage.getItem("barcaCoins");
    const savedNewUserDays = localStorage.getItem("newUserDays");
    const savedOldDone = localStorage.getItem("oldDone");
    
    if (savedCoins) setUserCoins(parseInt(savedCoins));
    if (savedNewUserDays) setNewUserDays(parseInt(savedNewUserDays));
    if (savedOldDone) setOldDone(savedOldDone === "true");
  }, []);

  // Accelerated timer - stayed in room daily tracker
  useEffect(() => {
    const interval = setInterval(() => {
      setRoomSeconds(prev => {
        const next = prev + 1;
        // 7200 seconds is 2 hours. In development or live, stay increments.
        if (next >= 7200) {
          if (newUserDays < 8) {
            const nextDays = newUserDays + 1;
            setNewUserDays(nextDays);
            localStorage.setItem("newUserDays", nextDays.toString());
          } else {
            setOldDone(true);
            localStorage.setItem("oldDone", "true");
          }
          showToast("Stay limit completed for today's task!");
          return 0;
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [newUserDays]);

  const awardCoinsInFirestore = async (amount: number) => {
    if (!currentUser) return;
    const userRef = doc(db, 'users', currentUser.uid);
    try {
      await updateDoc(userRef, {
        coins: increment(amount)
      });
    } catch (e) {
      console.error("Error rewarding coins:", e);
    }
  };

  const claimNewReward = async () => {
    if (newUserDays >= 8) {
      const nextCoins = userCoins + 20000;
      setUserCoins(nextCoins);
      localStorage.setItem("barcaCoins", nextCoins.toString());
      await awardCoinsInFirestore(20000);
      setNewUserDays(0);
      localStorage.setItem("newUserDays", "0");
      showToast("20000 Coins added!");
      triggerNotification('success');
    } else {
      showToast(`Keep staying! Completed: ${newUserDays}/8 days`);
      triggerNotification('warning');
    }
  };

  const claimOldReward = async () => {
    if (oldDone) {
      const nextCoins = userCoins + 10000;
      setUserCoins(nextCoins);
      localStorage.setItem("barcaCoins", nextCoins.toString());
      await awardCoinsInFirestore(10000);
      setOldDone(false);
      localStorage.setItem("oldDone", "false");
      showToast("10000 Coins added!");
      triggerNotification('success');
    } else {
      showToast("Complete stay daily first!");
      triggerNotification('warning');
    }
  };

  const withdrawCoins = async () => {
    if (!withdrawAccount.trim()) {
      showToast("Enter NOWPayments Crypto address!");
      triggerNotification('warning');
      return;
    }
    if (userCoins < 100000) {
      showToast("Minimum withdrawal is 100000");
      triggerNotification('warning');
      return;
    }
    // Trigger medium haptic feedback on processing withdrawal submit
    triggerImpact('medium');

    try {
      const userRef = doc(db, 'users', currentUser!.uid);
      await updateDoc(userRef, {
        coins: increment(-100000)
      });
      await addDoc(collection(db, 'withdrawalRequests'), {
        userId: currentUser!.uid,
        userName: currentUser!.displayName || 'Anonymous',
        amount: 100000,
        account: withdrawAccount,
        status: 'pending',
        createdAt: serverTimestamp()
      });
      const nextCoins = userCoins - 100000;
      setUserCoins(nextCoins);
      localStorage.setItem("barcaCoins", nextCoins.toString());
      showToast("10 USD withdrawal request submitted!");
      setWithdrawAccount('');
      triggerNotification('success');
    } catch (error) {
      console.error("error submitting withdrawal request", error);
      showToast("Withdrawal failed");
      triggerNotification('error');
    }
  };

  const handleProfileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && currentUser) {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const base64 = event.target?.result as string;
        try {
          const userRef = doc(db, 'users', currentUser.uid);
          await updateDoc(userRef, {
            photoURL: base64
          });
          showToast("Profile photo updated!");
        } catch (err) {
          console.error("Error setting profile photo URL:", err);
          showToast("Failed to upload profile");
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const setSeats = async (count: number) => {
    if (!roomId) return;
    try {
      const roomRef = doc(db, 'voiceRooms', roomId);
      await updateDoc(roomRef, {
        maxSeats: count
      });
      showToast(`Seats count set to ${count}!`);
    } catch (e) {
      console.error("Error setting seats:", e);
    }
  };

  const toggleSeatSimulation = (index: number) => {
    setSpeakingSeats(prev => ({
      ...prev,
      [index]: !prev[index]
    }));
  };

  const callsRef = useRef<Record<string, MediaConnection>>({});

  const isSpeaker = currentUser ? !!(room?.speakers && room.speakers[currentUser.uid]) : false;
  const isHost = currentUser ? room?.hostId === currentUser.uid : false;
  const roomLink = window.location.origin + '/rooms/' + roomId;

  const copyToClipboard = () => {
    navigator.clipboard.writeText(roomLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  useEffect(() => {
    if (room && prevRoomRef.current) {
      const prevUsers = { ...prevRoomRef.current.speakers, ...prevRoomRef.current.listeners };
      const currUsers = { ...room.speakers, ...room.listeners };
      
      const joined = Object.keys(currUsers).filter(id => !prevUsers[id]);
      const left = Object.keys(prevUsers).filter(id => !currUsers[id]);
      
      if (joined.length > 0) playSound('join');
      if (left.length > 0) playSound('leave');
    }
    prevRoomRef.current = room;
  }, [room]);


  useEffect(() => {
    if (!('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)) {
      setTranscription("Speech recognition not supported in this browser.");
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    recognitionRef.current = new SpeechRecognition();
    recognitionRef.current.continuous = true;
    recognitionRef.current.interimResults = true;
    recognitionRef.current.lang = 'en-US';

    recognitionRef.current.onresult = (event: any) => {
      let interimTranscript = '';
      let finalTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        } else {
          interimTranscript += event.results[i][0].transcript;
        }
      }
      setTranscription(prev => prev + finalTranscript + interimTranscript);
    };

    recognitionRef.current.onerror = (event: any) => {
      console.error("Speech recognition error", event.error);
    };
  }, []);

  useEffect(() => {
    const isSpeaker = currentUser ? !!(room?.speakers && room.speakers[currentUser.uid]) : false;
    if (isSpeaker && myStream) {
      recognitionRef.current?.start();
    } else {
      recognitionRef.current?.stop();
    }
  }, [room?.speakers, myStream, currentUser]);

  // Listen to reactions
  useEffect(() => {
    if (!roomId) return;
    const reactionsRef = collection(db, 'voiceRooms', roomId, 'reactions');
    const q = query(reactionsRef, orderBy('timestamp', 'desc'), limit(10));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const newReactions = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as any[];
      setReactions(newReactions);
      
      // Clear reactions after a few seconds
      setTimeout(() => {
        setReactions(prev => prev.filter(r => !newReactions.find(nr => nr.id === r.id)));
      }, 3000);
    }, (error) => {
      if (error.code !== 'permission-denied') {
        console.error("Error in reactions snapshot:", error);
      }
    });
    return () => unsubscribe();
  }, [roomId]);

  const sendReaction = async (emoji: string) => {
    if (!currentUser || !roomId) return;
    await addDoc(collection(db, 'voiceRooms', roomId, 'reactions'), {
      emoji,
      userId: currentUser.uid,
      timestamp: serverTimestamp()
    });
  };

  useEffect(() => {
    if (!currentUser || !roomId) return;

    const newPeer = new Peer();
    
    newPeer.on('open', async (id) => {
      setMyPeerId(id);
      setPeer(newPeer);
      
      // Join as listener initially
      const roomRef = doc(db, 'voiceRooms', roomId);
      await updateDoc(roomRef, {
        [`listeners.${currentUser.uid}`]: {
          peerId: id,
          userName: currentUser.displayName || 'Anonymous'
        }
      });
    });

    newPeer.on('call', (call) => {
      // Answer incoming call with our stream if we have one (we are a speaker)
      if (myStream) {
        call.answer(myStream);
      } else {
        call.answer();
      }
      
      call.on('stream', (remoteStream) => {
        handleRemoteStream(call.peer, remoteStream);
      });
      
      callsRef.current[call.peer] = call;
    });

    return () => {
      leaveRoom(newPeer);
    };
  }, [roomId, currentUser]);

  // Listen to room changes
  useEffect(() => {
    if (!roomId || !myPeerId || !peer) return;

    const roomRef = doc(db, 'voiceRooms', roomId);
    const unsubscribe = onSnapshot(roomRef, (docSnap) => {
      if (!docSnap.exists()) {
        navigate('/rooms');
        return;
      }
      
      const data = docSnap.data() as RoomData;
      setRoom(data);
      
      // If I am a speaker, I should call anyone I'm not connected to
      const amISpeaker = data.speakers && data.speakers[currentUser!.uid];
      
      if (amISpeaker && myStream) {
        const allPeers = [
          ...Object.values(data.speakers || {}).map(s => s.peerId),
          ...Object.values(data.listeners || {}).map(l => l.peerId)
        ];
        
        allPeers.forEach(targetPeerId => {
          if (targetPeerId !== myPeerId && !callsRef.current[targetPeerId]) {
            const call = peer.call(targetPeerId, myStream);
            if (call) {
              call.on('stream', (remoteStream) => {
                handleRemoteStream(targetPeerId, remoteStream);
              });
              callsRef.current[targetPeerId] = call;
            }
          }
        });
      }
    }, (error) => {
      if (error.code === 'permission-denied') {
        console.log("Permission denied for voiceRoom details. User might be unauthenticated.");
      } else {
        console.error("Error in voiceRoom details snapshot:", error);
      }
    });

    return () => unsubscribe();
  }, [roomId, myPeerId, peer, myStream, currentUser]);

  const handleRemoteStream = (peerId: string, stream: MediaStream) => {
    setRemoteStreams(prev => ({ ...prev, [peerId]: stream }));
  };

  const leaveRoom = async (currentPeer: Peer | null) => {
    if (!currentUser || !roomId) return;
    
    // Stop local stream
    if (myStream) {
      myStream.getTracks().forEach(track => track.stop());
      setMyStream(null);
    }
    setRemoteStreams({});
    
    // Close all calls
    Object.values(callsRef.current).forEach(call => call.close());
    
    if (currentPeer) {
      currentPeer.destroy();
    }

    // Remove from Firestore
    try {
      const roomRef = doc(db, 'voiceRooms', roomId);
      const roomSnap = await getDoc(roomRef);
      if (roomSnap.exists()) {
        await updateDoc(roomRef, {
          [`speakers.${currentUser.uid}`]: deleteField(),
          [`listeners.${currentUser.uid}`]: deleteField()
        });
      }
    } catch (e) {
      console.error("Error leaving room", e);
    }
  };

  const handleLeaveClick = () => {
    navigate('/rooms');
  };

  const toggleMute = async () => {
    if (!currentUser || !roomId || !myStream) return;

    const audioTrack = myStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      setIsMuted(!audioTrack.enabled);

      const roomRef = doc(db, 'voiceRooms', roomId);
      await updateDoc(roomRef, {
        [`speakers.${currentUser.uid}.isMuted`]: !audioTrack.enabled
      });
    }
  };

  // Listen to mute status from host
  useEffect(() => {
    if (!currentUser || !myStream) return;
    
    const mySpeakerData = room?.speakers?.[currentUser.uid];
    if (mySpeakerData) {
      const audioTrack = myStream.getAudioTracks()[0];
      if (audioTrack && audioTrack.enabled === mySpeakerData.isMuted) {
        audioTrack.enabled = !mySpeakerData.isMuted;
        setIsMuted(mySpeakerData.isMuted);
      }
    }
  }, [room?.speakers, currentUser, myStream]);

  const toggleMusic = async () => {
    if (!currentUser || !roomId || !room) return;
    const isHost = room.hostId === currentUser.uid;
    if (!isHost && !isSpeaker) return; // Only speakers/host can control music

    const newPlayingState = !room.isMusicPlaying;
    await updateDoc(doc(db, 'voiceRooms', roomId), {
      isMusicPlaying: newPlayingState
    });
  };

  const changeMusic = async (url: string) => {
    if (!currentUser || !roomId || !room) return;
    const isHost = room.hostId === currentUser.uid;
    if (!isHost && !isSpeaker) return;

    await updateDoc(doc(db, 'voiceRooms', roomId), {
      musicUrl: url,
      isMusicPlaying: true
    });
  };

  useEffect(() => {
    if (musicAudioRef.current) {
      if (room?.isMusicPlaying) {
        musicAudioRef.current.play().catch(e => console.log("Autoplay blocked or error", e));
      } else {
        musicAudioRef.current.pause();
      }
    }
    setIsPlayingMusic(!!room?.isMusicPlaying);
    setMusicUrl(room?.musicUrl || null);
  }, [room?.isMusicPlaying, room?.musicUrl]);

  if (!room) return <div className="p-8 text-center">Loading room...</div>;

  const muteAll = async () => {
    if (!currentUser || !roomId || !room || !isHost) return;
    
    const updates: Record<string, any> = {};
    Object.keys(room.speakers).forEach(uid => {
      updates[`speakers.${uid}.isMuted`] = true;
    });
    
    await updateDoc(doc(db, 'voiceRooms', roomId), updates);
  };

  const removeListener = async (listenerId: string) => {
    if (!currentUser || !roomId || !isHost) return;
    
    await updateDoc(doc(db, 'voiceRooms', roomId), {
      [`listeners.${listenerId}`]: deleteField()
    });
  };

  const updateRoomSettings = async () => {
    if (!currentUser || !roomId || !isHost) return;
    await updateDoc(doc(db, 'voiceRooms', roomId), {
      name: editName,
      topic: editTopic
    });
    setShowSettingsModal(false);
  };

  const totalSeats = room?.maxSeats || 9;

  const seats = Array.from({ length: totalSeats }, (_, i) => {
    const speakerEntry = Object.entries(room?.speakers || {}).find(([_, s]) => s.seatIndex === i);
    return speakerEntry ? { userId: speakerEntry[0], ...speakerEntry[1] } : null;
  });

  const hostSeat = Object.entries(room?.speakers || {}).find(([uid, _]) => uid === room?.hostId);
  const hostData = hostSeat ? { userId: hostSeat[0], ...hostSeat[1] } : (room?.listeners && room?.listeners[room?.hostId || ''] ? { userId: room?.hostId, ...room?.listeners[room?.hostId || ''], isMuted: true } : null);
  const hostProfile = hostProfiles[room?.hostId || ''];

  const takeSeatAtIndex = async (index: number) => {
    if (!currentUser || !roomId || !room || !myPeerId) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      let finalStream = stream;

      if (isHost && musicAudioRef.current) {
        const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
        const ctx = new AudioContext();
        const dest = ctx.createMediaStreamDestination();
        const micSource = ctx.createMediaStreamSource(stream);
        micSource.connect(dest);

        const musicSource = ctx.createMediaElementSource(musicAudioRef.current);
        const musicGain = ctx.createGain();
        musicGain.gain.value = 0.4;
        musicSource.connect(musicGain);
        musicGain.connect(dest);

        musicSourceRef.current = musicSource;
        audioDestinationRef.current = dest;
        finalStream = dest.stream;
      }

      setMyStream(finalStream);

      const roomRef = doc(db, 'voiceRooms', roomId);
      await updateDoc(roomRef, {
        [`listeners.${currentUser.uid}`]: deleteField(),
        [`speakers.${currentUser.uid}`]: {
          seatIndex: index,
          isMuted: false,
          peerId: myPeerId,
          userName: currentUser.displayName || 'Anonymous'
        }
      });

      Object.values(callsRef.current).forEach(call => call.close());
      callsRef.current = {};

      if (room.speakers) {
        Object.values(room.speakers).forEach(speaker => {
          if (speaker.peerId !== myPeerId && peer) {
            const call = peer.call(speaker.peerId, finalStream);
            call.on('stream', (remoteStream) => {
              handleRemoteStream(speaker.peerId, remoteStream);
            });
            callsRef.current[speaker.peerId] = call;
          }
        });
      }
      showToast(`Joined Seat ${index + 1}!`);
    } catch (err) {
      console.error("Error securing microphone:", err);
      showToast("Microphone access denied.");
    }
  };

  const handleSeatClick = async (index: number, seat: any) => {
    if (seat) {
      toggleSeatSimulation(index);
    } else {
      if (!isSpeaker) {
        await takeSeatAtIndex(index);
      } else {
        try {
          const roomRef = doc(db, 'voiceRooms', roomId!);
          await updateDoc(roomRef, {
            [`speakers.${currentUser!.uid}.seatIndex`]: index
          });
          showToast(`Moved to Seat ${index + 1}`);
        } catch (e) {
          console.error("Error shifting index:", e);
        }
      }
    }
  };

  return (
    <div className="relative min-h-screen w-full text-white bg-[#111] overflow-x-hidden p-0 m-0">
      {/* Background Image with blur & dark overlay */}
      <div className="fixed inset-0 w-full h-full overflow-hidden z-0 pointer-events-none">
        <img 
          className="absolute inset-0 w-full h-full object-cover filter blur-[3px] scale-105" 
          src="https://images.unsplash.com/photo-1516280440614-37939bbacd81?q=80&w=1400&auto=format&fit=crop" 
          alt="Room Background"
        />
        <div className="absolute inset-0 bg-black/45"></div>
      </div>

      {/* Floating LIVE badge */}
      <div className="absolute top-[18px] left-1/2 -translate-x-1/2 bg-red-600 border border-red-500/30 px-[18px] py-[6px] rounded-[20px] text-xs font-bold z-20 shadow-lg animate-pulse">
        🔴 LIVE
      </div>

      {/* Main layout grid */}
      <div className="relative z-10 max-w-7xl mx-auto w-full px-4 pt-[100px] pb-[160px] flex flex-col lg:flex-row gap-6 animate-fade-in">
        <div className="flex-1 flex flex-col">
          {error && <div className="bg-red-500/20 border border-red-500/30 text-red-400 p-3 rounded-xl mb-4">{error}</div>}

          {/* Core Voice Room content panel */}
          <div className="room-glass-panel rounded-3xl p-6 border border-white/10 shadow-2xl relative min-h-[600px] flex flex-col justify-between">
            {/* Top info and controllers */}
            <div className="flex flex-col md:flex-row justify-between items-start gap-4 mb-4">
              {/* Host Box */}
              <div className="flex items-center gap-[10px] bg-black/45 px-4 py-3 rounded-[20px] backdrop-blur-[10px] border border-white/5">
                <img 
                  className="w-[55px] h-[55px] rounded-full border-2 border-white object-cover shadow-md" 
                  src={speakerProfiles[room?.hostId || '']?.photoURL || hostProfile?.photoURL || "https://i.pravatar.cc/150?img=12"} 
                  referrerPolicy="no-referrer"
                  alt="Host Avatar"
                />
                <div className="text-left">
                  <h3 className="text-[15px] font-bold text-white max-w-[200px] truncate">{room?.name}</h3>
                  <p className="text-[12px] opacity-80 text-blue-400 font-mono">ID: {roomId?.substring(0, 10)}</p>
                  <p className="text-[10px] opacity-70">Host: {speakerProfiles[room?.hostId || '']?.userName || hostProfile?.userName || hostData?.userName || 'Host'}</p>
                </div>
              </div>

              {/* Action Buttons to trigger side drawers */}
              <div className="flex gap-[10px] self-end md:self-center">
                <button 
                  onClick={() => setActivePanel(activePanel === 'controlPanel' ? null : 'controlPanel')}
                  className="w-[42px] h-[42px] rounded-full bg-white/15 hover:bg-white/25 flex justify-center items-center text-xl cursor-pointer transition-all active:scale-90"
                  title="Room Settings & Controls"
                >
                  ☰
                </button>
                <button 
                  onClick={copyToClipboard}
                  className="w-[42px] h-[42px] rounded-full bg-white/15 hover:bg-white/25 flex justify-center items-center text-xl cursor-pointer transition-all active:scale-90"
                  title="Copy Link"
                >
                  {copied ? '✅' : '🔗'}
                </button>
                <button 
                  onClick={handleLeaveClick}
                  className="w-[42px] h-[42px] rounded-full bg-red-600/60 hover:bg-red-600 flex justify-center items-center text-xl cursor-pointer transition-all active:scale-95 font-bold"
                  title="Leave Room"
                >
                  ✖
                </button>
              </div>
            </div>

            {/* Coin boxes */}
            <div className="flex gap-[10px] mb-6 flex-wrap">
              <div className="bg-gradient-to-r from-[#ffcc00] to-[#ff9900] px-[15px] py-[8px] rounded-[20px] text-[13px] font-black text-black shadow-md flex items-center gap-1.5 animate-bounce">
                🪙 <span>{userCoins}</span>
              </div>
              <div className="bg-white/15 border border-white/5 px-[15px] py-[8px] rounded-[20px] text-[13px] font-bold shadow-md flex items-center gap-1.5">
                🎮 <span>{userPoints}</span>
              </div>
              <div className="bg-blue-600/20 border border-blue-500/20 px-[15px] py-[8px] rounded-[20px] text-[12px] font-bold text-blue-400 flex items-center gap-1.5">
                👥 Speakers: {Object.keys(room?.speakers || {}).length}
              </div>
            </div>

            {/* Room Seats Grid */}
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-y-12 gap-x-6 justify-items-center max-h-[42vh] overflow-y-auto mb-8 p-4 bg-black/20 rounded-3xl border border-white/5 scrollbar-thin">
              {seats.map((seat, index) => {
                const isSpeakingSim = speakingSeats[index];
                const isCrown = index <= 2;
                return (
                  <div 
                    key={index} 
                    className="flex flex-col items-center relative cursor-pointer"
                    onClick={() => handleSeatClick(index, seat)}
                  >
                    {/* Crown on Seats 1, 2, 3 */}
                    {isCrown && (
                      <span className="absolute -top-[16px] text-[20px] animate-bounce z-10 filter drop-shadow">👑</span>
                    )}

                    {/* Seat bubble */}
                    <div 
                      className={`w-[75px] h-[75px] rounded-full bg-white/10 flex justify-center items-center border-2 transition-all relative overflow-hidden backdrop-blur-md ${
                        seat 
                          ? `border-[#00ffd5]/40 ${isSpeakingSim || (seat.userId === currentUser?.uid && !isMuted) ? 'speaking-active' : ''}`
                          : 'border-dashed border-white/20 hover:border-white/45'
                      }`}
                    >
                      {seat ? (
                        <div className="w-full h-full relative">
                          {seat.userId === currentUser?.uid && myStream ? (
                            <VideoElement stream={myStream} muted />
                          ) : remoteStreams[seat.peerId] ? (
                            <VideoElement stream={remoteStreams[seat.peerId]} />
                          ) : (
                            <img 
                              className="w-full h-full object-cover" 
                              src={speakerProfiles[seat.userId]?.photoURL || "https://i.pravatar.cc/150?img=" + (15 + index)} 
                              referrerPolicy="no-referrer"
                              alt={seat.userName} 
                            />
                          )}
                          {seat.isMuted && (
                            <div className="absolute bottom-1 right-1 bg-red-600 rounded-full p-0.5 border border-black text-white text-[9px] w-[18px] h-[18px] flex items-center justify-center font-bold">
                              🔇
                            </div>
                          )}
                          {reactions.filter(r => r.userId === seat.userId).map(r => (
                            <div key={r.id} className="absolute -top-1 right-0 bg-white rounded-full p-1 shadow-lg text-sm z-30 animate-bounce">{r.emoji}</div>
                          ))}
                        </div>
                      ) : (
                        <span className="text-[24px]">🎤</span>
                      )}
                    </div>

                    {/* Information under bubble */}
                    <span className="mt-2 text-[12px] font-bold text-white/90 max-w-[80px] truncate text-center">
                      {seat ? speakerProfiles[seat.userId]?.userName || seat.userName : `Seat ${index + 1}`}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Room Rules & Notice */}
            <div className="bg-black/60 p-4 rounded-2xl text-[13px] line-height-relaxed border border-white/5 mb-6 text-white/80 select-none">
              <b className="text-blue-400">📋 Room Rules</b>
              <div className="grid grid-cols-2 gap-2 mt-2 font-medium">
                <div>1. Respect all members</div>
                <div>2. Avoid abusive talks</div>
                <div>3. Enjoy live discussions</div>
                <div>4. Music shared globally</div>
              </div>
            </div>

            {/* Live Emoji Reactions Panel */}
            <div className="flex gap-3.5 justify-center mb-6 bg-black/50 p-3 rounded-full border border-white/5 max-w-xs mx-auto backdrop-blur-md">
              {['❤️', '👏', '🔥', '🎉', '😂', '👑'].map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => {
                    playSound('click');
                    sendReaction(emoji);
                  }}
                  className="hover:scale-130 active:scale-90 transition-transform text-2xl hover:text-white cursor-pointer duration-100"
                >
                  {emoji}
                </button>
              ))}
            </div>

            {/* Bottom menu bar */}
            <div className="flex justify-around items-center bg-black/60 p-3 rounded-2xl border border-white/10 backdrop-blur-xl shrink-0 mt-auto">
              <div 
                className="flex flex-col items-center gap-1 cursor-pointer transition-transform active:scale-95 group" 
                onClick={async () => {
                  if (isSpeaker) {
                    await toggleMute();
                  } else {
                    // Try to seat automatically at first free seat
                    const occupied = Object.values(room?.speakers || {}).map(s => s.seatIndex);
                    let freeIndex = -1;
                    for (let x = 0; x < totalSeats; x++) {
                      if (!occupied.includes(x)) {
                        freeIndex = x;
                        break;
                      }
                    }
                    if (freeIndex !== -1) {
                      await takeSeatAtIndex(freeIndex);
                    } else {
                      showToast("All seats are occupied right now!");
                    }
                  }
                }}
              >
                <div className={`w-[45px] h-[45px] rounded-[14px] bg-white/10 flex justify-center items-center text-xl transition-all group-hover:bg-white/20 ${isSpeaker && !isMuted ? 'bg-green-500/30 border border-green-500/50 text-white' : ''}`}>
                  {isSpeaker && isMuted ? '🔇' : '🎤'}
                </div>
                <span className="text-[10px] text-white/70 font-semibold">Mic</span>
              </div>

              <div 
                className="flex flex-col items-center gap-1 cursor-pointer transition-transform active:scale-95 group" 
                onClick={() => setActivePanel(activePanel === 'musicPanel' ? null : 'musicPanel')}
              >
                <div className={`w-[45px] h-[45px] rounded-[14px] bg-white/10 flex justify-center items-center text-xl transition-all group-hover:bg-white/20 ${activePanel === 'musicPanel' ? 'bg-blue-500/30 border border-blue-500/50' : ''}`}>
                  🎵
                </div>
                <span className="text-[10px] text-white/70 font-semibold">Music</span>
              </div>

              <div 
                className="flex flex-col items-center gap-1 cursor-pointer transition-transform active:scale-95 group" 
                onClick={() => setActivePanel(activePanel === 'gamesPanel' ? null : 'gamesPanel')}
              >
                <div className={`w-[45px] h-[45px] rounded-[14px] bg-white/10 flex justify-center items-center text-xl transition-all group-hover:bg-white/20 ${activePanel === 'gamesPanel' ? 'bg-purple-500/30 border border-purple-500/50' : ''}`}>
                  🎮
                </div>
                <span className="text-[10px] text-white/70 font-semibold">Games</span>
              </div>

              <div 
                className="flex flex-col items-center gap-1 cursor-pointer transition-transform active:scale-95 group" 
                onClick={() => setActivePanel(activePanel === 'taskPanel' ? null : 'taskPanel')}
              >
                <div className={`w-[45px] h-[45px] rounded-[14px] bg-white/10 flex justify-center items-center text-xl transition-all group-hover:bg-white/20 ${activePanel === 'taskPanel' ? 'bg-yellow-500/30 border border-yellow-500/40' : ''}`}>
                  🎯
                </div>
                <span className="text-[10px] text-white/70 font-semibold">Tasks</span>
              </div>
            </div>
          </div>

          {/* Real-time speech transcription card */}
          <div className="mt-6 bg-[#161616]/80 backdrop-blur-md rounded-3xl p-5 border border-white/5 shadow-xl">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-black text-blue-400 uppercase tracking-widest flex items-center gap-2">
                💬 Live Speech Transcription
              </h2>
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></span>
                <span className="text-[9px] text-slate-500 font-bold uppercase tracking-wider">AI Synced</span>
              </div>
            </div>
            <p className="text-xs text-white/75 bg-black/40 p-3 rounded-2xl min-h-[70px] max-h-[120px] overflow-y-auto leading-relaxed border border-white/5 scrollbar-thin">
              {transcription || "Silence. Start speaking into your mic to transcribe..."}
            </p>
          </div>

          {/* Listeners section */}
          <div className="mt-6 bg-black/20 rounded-3xl p-5 border border-white/5">
            <h3 className="text-xs font-bold text-white/70 uppercase tracking-widest mb-3 flex items-center gap-1.5">
              👥 Listeners ({Object.keys(room?.listeners || {}).length})
            </h3>
            <div className="flex flex-wrap gap-2.5">
              {Object.entries(room?.listeners || {}).map(([uid, lis]) => (
                <div 
                  key={uid} 
                  className="bg-white/5 backdrop-blur-sm px-3.5 py-1.5 rounded-full text-[12px] flex items-center gap-2 border border-white/5 group hover:border-white/10 duration-200"
                >
                  <div className="w-[18px] h-[18px] bg-white/10 rounded-full flex items-center justify-center text-[10px]">
                    👤
                  </div>
                  <span className="font-bold text-white/80">{lis.userName}</span>
                  {isHost && (
                    <button 
                      onClick={() => removeListener(uid)} 
                      className="text-white/40 hover:text-red-400 font-black text-[11px] ml-1 duration-200"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
              {Object.keys(room?.listeners || {}).length === 0 && (
                <p className="text-white/40 text-[11px] font-medium italic">No passive listeners yet.</p>
              )}
            </div>
          </div>
        </div>

        {/* Chat Sidebar column */}
        <div className="w-full lg:w-80 flex flex-col shrink-0">
          <div className="room-glass-panel rounded-3xl p-4 border border-white/10 shadow-2xl h-[560px] flex flex-col">
            <div className="flex items-center justify-between mb-3 px-1 border-b border-white/5 pb-2">
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                💬 Room Chat Logs
              </h2>
              <button 
                onClick={() => setShowChat(!showChat)}
                className="text-[11px] bg-white/10 hover:bg-white/20 px-2 py-1 rounded-md text-white/80"
              >
                {showChat ? 'Hide' : 'Show'}
              </button>
            </div>
            {showChat && (
              <div className="flex-1 overflow-hidden">
                <Chat 
                  roomId={roomId || ''} 
                  isHost={isHost} 
                  className="flex-1 flex flex-col overflow-hidden bg-transparent p-0 m-0 shadow-none h-full"
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ==================== */}
      {/* 1. CONTROL PANEL SIDE-BAR */}
      {/* ==================== */}
      <div className={`fixed top-0 right-0 h-full w-[90%] max-w-[400px] bg-[#141414] border-l border-white/10 p-6 overflow-y-auto duration-300 z-50 flex flex-col justify-between shadow-2xl ${activePanel === 'controlPanel' ? 'translate-x-0' : 'translate-x-full'}`}>
        <div>
          <div className="flex justify-between items-center border-b border-white/10 pb-4 mb-6">
            <h2 className="text-lg font-black tracking-tight text-white flex items-center gap-2">
              ⚙️ Room Control Centre
            </h2>
            <button 
              className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 font-bold flex items-center justify-center opacity-80 hover:opacity-100" 
              onClick={() => setActivePanel(null)}
            >
              ✖
            </button>
          </div>

          <div className="space-y-6">
            <div>
              <h3 className="text-sm font-bold text-white/90 mb-3 flex items-center gap-1">
                🪑 Adjust Room Seats
              </h3>
              <p className="text-[12px] text-white/60 mb-3 font-medium">Update total available mic slots for this room in real-time:</p>
              <div className="grid grid-cols-3 gap-2">
                {[6, 9, 12, 16, 24].map((num) => (
                  <button 
                    key={num}
                    onClick={() => {
                      if (!isHost) {
                        showToast("Only the host can modify seats!");
                        return;
                      }
                      setSeats(num);
                    }}
                    className={`py-2 px-1 rounded-xl text-xs font-bold transition-all duration-150 ${
                      totalSeats === num 
                        ? 'bg-blue-600 text-white shadow font-black' 
                        : 'bg-white/10 hover:bg-white/20 text-white/80'
                    }`}
                  >
                    {num} Seats
                  </button>
                ))}
              </div>
            </div>

            <div className="border-t border-white/5 pt-5">
              <h3 className="text-sm font-bold text-white/90 mb-2">
                🖼️ Upload Custom Room / Profile Image
              </h3>
              <input 
                type="file" 
                id="profileUpload"
                onChange={handleProfileUpload}
                accept="image/*"
                className="block w-full text-xs text-white/60 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-[#00d5b5] file:text-black hover:file:bg-[#00ffd5] cursor-pointer mt-2"
              />
            </div>

            {isHost && (
              <div className="border-t border-white/5 pt-5 space-y-3">
                <h3 className="text-sm font-bold text-red-400">🚨 Host Commands</h3>
                <button 
                  onClick={muteAll}
                  className="w-full py-3 bg-red-600/35 hover:bg-red-600 text-white border border-red-500/50 rounded-xl text-xs font-bold transition-all active:scale-95 duration-150"
                >
                  Mute All Active Voice Nodes
                </button>
                <button 
                  onClick={() => {
                    setEditName(room?.name || '');
                    setEditTopic(room?.topic || '');
                    setShowSettingsModal(true);
                  }}
                  className="w-full py-3 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-bold transition-all border border-white/5"
                >
                  Update Room Name & Topic
                </button>
              </div>
            )}
          </div>
        </div>

        <p className="text-[10px] text-white/40 italic text-center border-t border-white/5 pt-3">
          Powered by Barca-live realtime engine
        </p>
      </div>

      {/* ==================== */}
      {/* 2. MUSIC PANEL SIDE-BAR */}
      {/* ==================== */}
      <div className={`fixed top-0 right-0 h-full w-[90%] max-w-[400px] bg-[#141414] border-l border-white/10 p-6 overflow-y-auto duration-300 z-50 shadow-2xl flex flex-col justify-between ${activePanel === 'musicPanel' ? 'translate-x-0' : 'translate-x-full'}`}>
        <div>
          <div className="flex justify-between items-center border-b border-white/10 pb-4 mb-6">
            <h2 className="text-lg font-black tracking-tight text-white flex items-center gap-2">
              🎵 Global Room Music
            </h2>
            <button 
              className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 font-bold flex items-center justify-center" 
              onClick={() => setActivePanel(null)}
            >
              ✖
            </button>
          </div>

          <div className="space-y-5">
            <p className="text-xs text-white/70">Select global background music to play synced to all participants:</p>

            <div className="bg-black/30 p-4 rounded-2xl border border-white/5">
              <label className="text-[11px] font-bold uppercase tracking-wider text-white/50 block mb-2">Preset Atmosphere</label>
              <select 
                onChange={(e) => changeMusic(e.target.value)}
                value={musicUrl || ''}
                disabled={!isSpeaker && !isHost}
                className="w-full bg-[#1e1e1e] text-white text-xs p-3.5 rounded-xl outline-none border border-white/5 focus:border-blue-500 transition-all cursor-pointer disabled:opacity-50 font-bold"
              >
                <option value="">No Background Music</option>
                <option value="https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3 font-semibold">Chill Electronic 01</option>
                <option value="https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3 font-semibold">Lofi Study Beats 02</option>
                <option value="https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3 font-semibold font-mono">Deep Focus Ambient 03</option>
                <option value="https://www.soundhelix.com/examples/mp3/SoundHelix-Song-10.mp3 font-mono">Uplifting Synth 04</option>
              </select>
            </div>

            <div className="flex flex-col gap-2.5 mt-4">
              <button 
                onClick={toggleMusic}
                disabled={!musicUrl || (!isSpeaker && !isHost)}
                className={`w-full py-3.5 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-30 ${isPlayingMusic ? 'bg-blue-600 text-white shadow-lg' : 'bg-white/10 text-white/80 border border-white/5'}`}
              >
                {isPlayingMusic ? '⏸ Pause Shared Stream' : '▶ Publish Shared Stream'}
              </button>
            </div>

            {musicUrl && (
              <div className="mt-4 bg-black/40 p-4 rounded-xl border border-white/5 flex flex-col gap-2">
                <span className="text-[10px] uppercase font-bold text-blue-400">Current Stream Active</span>
                <span className="text-xs truncate font-mono text-white/60">{musicUrl}</span>
                <audio ref={musicAudioRef} src={musicUrl} loop crossOrigin="anonymous" />
              </div>
            )}
          </div>
        </div>

        <p className="text-[10px] text-white/30 text-center italic leading-relaxed border-t border-white/5 pt-4">
          Atmospheric streams utilize high bitrate PeerJS pipeline audio mix.
        </p>
      </div>

      {/* ==================== */}
      {/* 3. GAMES PANEL SIDE-BAR */}
      {/* ==================== */}
      <div className={`fixed top-0 right-0 h-full w-[90%] max-w-[400px] bg-[#141414] border-l border-white/10 p-6 overflow-y-auto duration-300 z-50 shadow-2xl flex flex-col justify-between ${activePanel === 'gamesPanel' ? 'translate-x-0' : 'translate-x-full'}`}>
        <div>
          <div className="flex justify-between items-center border-b border-white/10 pb-4 mb-6">
            <h2 className="text-lg font-black tracking-tight text-white flex items-center gap-2">
              🎮 Interactive Board Games
            </h2>
            <button 
              className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 font-bold flex items-center justify-center" 
              onClick={() => setActivePanel(null)}
            >
              ✖
            </button>
          </div>

          <p className="text-xs text-white/70 mb-5 font-semibold">Click below to play interactive, multiplayer board games with other speakers:</p>
          
          <div className="grid grid-cols-2 gap-4">
            {[
              { emoji: '🎲', name: 'Ludo Dice' },
              { emoji: '🎱', name: '8 Ball Pool' },
              { emoji: '🏎', name: 'Race Tour' },
              { emoji: '🐟', name: 'Fish Hunter' },
              { emoji: '♟', name: 'Pro Chess' },
              { emoji: '⚽', name: 'Puck Soccer' }
            ].map((game, i) => (
              <div 
                key={i}
                onClick={() => {
                  playSound('click');
                  showToast(`Preparing ${game.name} Lobbies...`);
                }}
                className="bg-[#1f1f1f] border border-white/5 hover:border-white/20 h-[120px] rounded-3xl flex flex-col justify-center items-center text-4xl gap-2 cursor-pointer transition-transform duration-200 active:scale-95 hover:bg-[#252525]"
              >
                <span>{game.emoji}</span>
                <span className="text-[11px] font-bold text-white/75">{game.name}</span>
              </div>
            ))}
          </div>
        </div>

        <p className="text-[10px] text-white/40 text-center leading-relaxed border-t border-white/5 pt-4">
          Games synchronized with in-room chat logs.
        </p>
      </div>

      {/* ==================== */}
      {/* 4. DAILY TASK PANEL SIDE-BAR */}
      {/* ==================== */}
      <div className={`fixed top-0 right-0 h-full w-[90%] max-w-[420px] bg-[#141414] border-l border-white/10 p-6 overflow-y-auto duration-300 z-50 shadow-2xl flex flex-col justify-between ${activePanel === 'taskPanel' ? 'translate-x-0' : 'translate-x-full'}`}>
        <div>
          <div className="flex justify-between items-center border-b border-white/10 pb-4 mb-6">
            <h2 className="text-lg font-black tracking-tight text-white flex items-center gap-2">
              🎯 Tasks & Earnings
            </h2>
            <button 
              className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 font-bold flex items-center justify-center opacity-80 hover:opacity-100" 
              onClick={() => setActivePanel(null)}
            >
              ✖
            </button>
          </div>

          {myProfile && (
            <div className="flex items-center gap-3 mb-6 bg-white/5 p-4 rounded-3xl border border-white/5">
              <img 
                src={myProfile.photoURL || "https://i.pravatar.cc/150"} 
                className="w-10 h-10 rounded-full object-cover border border-[#00d5b5]/30 shadow-md" 
                referrerPolicy="no-referrer"
                alt={myProfile.userName}
              />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-black text-white truncate">{myProfile.userName}</div>
                <div className="text-[10px] text-white/50 truncate font-mono">{myProfile.email}</div>
              </div>
              <div className="text-[10px] bg-[#00d5b5]/10 text-[#00ffd5] border border-[#00ffd5]/20 px-2 py-1 rounded-xl font-bold font-mono">
                🪙 {userCoins}
              </div>
            </div>
          )}

          <div className="space-y-6">
            {/* New User Task */}
            <div className="bg-[#202020] border border-white/5 p-5 rounded-3xl flex flex-col gap-3">
              <div className="flex justify-between items-start">
                <h3 className="text-sm font-black text-white">🆕 New Member Task</h3>
                <span className="text-[10px] bg-[#00d5b5]/20 text-[#00ffd5] border border-[#00ffd5]/20 px-2 py-0.5 rounded-full font-bold">ACTIVE</span>
              </div>
              <p className="text-xs text-white/70">Stay active inside any voice session for at least 2 hours daily for 8 days.</p>
              <span className="text-[11px] text-yellow-500 font-bold">Reward: 20,000 Coins 🪙</span>
              
              <div className="w-full bg-[#333] h-[10px] rounded-full overflow-hidden mt-1">
                <div 
                  className="h-full bg-gradient-to-r from-[#00ffd5] to-[#00b7ff] transition-all duration-300"
                  style={{ width: `${(newUserDays / 8) * 100}%` }}
                ></div>
              </div>
              <div className="flex justify-between text-[11px] font-bold text-white/50">
                <span>{newUserDays} / 8 Days</span>
                <span>{(newUserDays / 8) * 100}% Done</span>
              </div>

              <button 
                onClick={claimNewReward}
                className="w-full py-2.5 bg-[#00d5b5] hover:bg-[#00ffd5] disabled:opacity-40 text-black text-xs font-black rounded-xl cursor-pointer duration-200 mt-1"
              >
                Claim Reward
              </button>
            </div>

            {/* Old User Task */}
            <div className="bg-[#202020] border border-white/5 p-5 rounded-3xl flex flex-col gap-3">
              <div className="flex justify-between items-start">
                <h3 className="text-sm font-black text-white">👑 Daily Voice Task</h3>
                <span className="text-[10px] bg-blue-600/20 text-blue-400 border border-blue-500/20 px-2 py-0.5 rounded-full font-bold">EVERYDAY</span>
              </div>
              <p className="text-xs text-white/70">Stay inside any active seat discussion for an cumulative 2 hours today.</p>
              <span className="text-[11px] text-yellow-500 font-bold">Reward: 10,000 Coins 🪙</span>
              
              <div className="w-full bg-[#333] h-[10px] rounded-full overflow-hidden mt-1">
                <div 
                  className="h-full bg-gradient-to-r from-[#00ffd5] to-[#00b7ff] transition-all duration-300"
                  style={{ width: oldDone ? '100%' : '0%' }}
                ></div>
              </div>
              <div className="flex justify-between text-[11px] font-bold text-white/50">
                <span>{oldDone ? 'Completed' : `Stayed today: ${Math.floor(roomSeconds / 60)}m (${roomSeconds}s)`}</span>
                <span>{oldDone ? '100% Completed' : '0 / 1 Completed'}</span>
              </div>

              <button 
                onClick={claimOldReward}
                className="w-full py-2.5 bg-[#00d5b5] hover:bg-[#00ffd5] text-black text-xs font-black rounded-xl cursor-pointer duration-200 mt-1"
              >
                Claim Reward
              </button>
            </div>

            {/* Withdrawal block */}
            <div className="bg-[#1a1a1a] border border-red-500/10 p-5 rounded-3xl flex flex-col gap-3.5 pt-5 mt-[20px]">
              <h3 className="text-sm font-black text-red-400">💵 Currency Withdrawal</h3>
              <p className="text-xs text-white/70 leading-relaxed font-semibold">Conversion exchange rate:<br/>
                <span className="text-yellow-500 text-sm">100,000 Coins = 10 USD</span>
              </p>

              <input 
                type="text"
                value={withdrawAccount}
                onChange={(e) => setWithdrawAccount(e.target.value)}
                placeholder="Type NOWPayments USDT/TON Address"
                className="w-full bg-black/45 border border-white/10 rounded-xl h-[45px] px-3.5 text-xs text-white outline-none focus:border-red-500 transition-colors font-medium"
              />

              <button 
                onClick={withdrawCoins}
                className="w-full py-3 bg-red-600 hover:bg-red-700 text-white text-xs font-black rounded-xl duration-200 cursor-pointer shadow"
              >
                Withdraw USD ($10)
              </button>
            </div>
          </div>
        </div>

        <p className="text-[10px] text-white/35 text-center italic border-t border-white/5 pt-4">
          Security systems monitor stays to protect against automated activity.
        </p>
      </div>

      {/* Real-time floating absolute bottom toast banner */}
      {toast && (
        <div className="fixed bottom-[115px] left-1/2 -translate-x-1/2 bg-black border border-white/10 shadow-2xl px-5 py-3 rounded-2xl z-[999999] text-xs font-bold text-center flex items-center gap-2 animate-bounce">
          💡 {toast}
        </div>
      )}

      {/* Settings management modal for Host only */}
      {showSettingsModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-[999999] backdrop-blur-sm">
          <div className="bg-[#181818] p-6 rounded-3xl w-full max-w-md border border-white/10 shadow-2xl relative">
            <h2 className="text-lg font-black text-white mb-5">Update Voice Room</h2>
            <div className="flex flex-col gap-4">
              <div>
                <label className="text-slate-400 text-xs font-bold mb-1.5 block">Room Banner Name</label>
                <input 
                  type="text" 
                  value={editName} 
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full bg-black/50 p-3 rounded-xl text-xs text-white border border-white/10 focus:border-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="text-slate-400 text-xs font-bold mb-1.5 block">Topic / Description</label>
                <input 
                  type="text" 
                  value={editTopic} 
                  onChange={(e) => setEditTopic(e.target.value)}
                  className="w-full bg-black/50 p-3 rounded-xl text-xs text-white border border-white/10 focus:border-blue-500 outline-none"
                />
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button 
                  onClick={() => setShowSettingsModal(false)} 
                  className="text-xs font-bold text-slate-400 hover:text-white px-4 py-2"
                >
                  Close
                </button>
                <button 
                  onClick={updateRoomSettings} 
                  className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-5 py-2.5 rounded-xl transition-all"
                >
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VoiceRoom;
