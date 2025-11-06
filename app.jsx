import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';

// --- Global Configuration and Utilities ---

// Define the available chat rooms
const DEFAULT_ROOMS = [
  { id: 'general', name: '# General Chat' },
  { id: 'tech', name: '# Tech Talk' },
  { id: idGenerator(), name: 'Global Broadcast' } // A non-joinable room for system messages
];

function idGenerator() {
  return crypto.randomUUID().substring(0, 8);
}

// Global server state where all clients connect (simulated database/server)
const serverState = {
  rooms: DEFAULT_ROOMS,
  clients: {}, // {socketId: { id, username, currentRoomId, isTyping, lastActive }}
  messages: [], // { id, senderId, senderName, roomId, content, timestamp, type: 'message'|'notification' }
  nextMessageId: 1,
};

// --- Simulated Socket.IO Server & Client Logic ---

/**
 * Custom hook to manage the simulated server logic.
 * This replaces the Node/Express/Socket.IO server.
 */
const useSimulatedServer = () => {
  const [state, setState] = useState(serverState);
  const timeoutsRef = useRef({});

  // Helper function to send a system notification message
  const broadcastNotification = useCallback((roomId, content) => {
    setState(prev => ({
      ...prev,
      messages: [
        ...prev.messages,
        {
          id: prev.nextMessageId++,
          type: 'notification',
          roomId: roomId,
          content: content,
          timestamp: new Date().toISOString(),
        }
      ]
    }));
  }, []);

  // Server event handler (emit from client -> listen on server)
  const handleServerEvent = useCallback((event, data, senderSocketId) => {
    setState(prev => {
      // Create a mutable copy of the state for updates
      const newState = { ...prev, clients: { ...prev.clients } };
      
      switch (event) {
        case 'connect': {
          const { username } = data;
          const newClient = {
            socketId: senderSocketId,
            id: idGenerator(),
            username: username,
            currentRoomId: DEFAULT_ROOMS[0].id, // Default to General
            isTyping: false,
            lastActive: new Date().toISOString(),
          };
          newState.clients[senderSocketId] = newClient;

          // Send notification to the default room
          broadcastNotification(DEFAULT_ROOMS[0].id, `${username} has joined the chat.`);
          break;
        }

        case 'disconnect': {
          const client = newState.clients[senderSocketId];
          if (client) {
            broadcastNotification(client.currentRoomId, `${client.username} has left the chat.`);
            delete newState.clients[senderSocketId];
          }
          break;
        }

        case 'joinRoom': {
          const client = newState.clients[senderSocketId];
          if (client && client.currentRoomId !== data.roomId) {
            // Notify old room that user left
            if (client.currentRoomId) {
              broadcastNotification(client.currentRoomId, `${client.username} left the room.`);
            }
            // Update client's room
            client.currentRoomId = data.roomId;
            // Notify new room that user joined
            broadcastNotification(data.roomId, `${client.username} joined the room.`);
          }
          break;
        }

        case 'message': {
          const client = newState.clients[senderSocketId];
          if (client && data.content.trim()) {
            newState.messages.push({
              id: newState.nextMessageId++,
              type: 'message',
              senderId: client.id,
              senderName: client.username,
              roomId: client.currentRoomId,
              content: data.content.trim(),
              timestamp: new Date().toISOString(),
            });
          }
          break;
        }

        case 'privateMessage': {
          const sender = newState.clients[senderSocketId];
          const receiver = Object.values(newState.clients).find(c => c.id === data.receiverId);
          
          if (sender && receiver && data.content.trim()) {
            // A DM is tagged with both sender and receiver IDs as its "roomId"
            const dmRoomId = [sender.id, receiver.id].sort().join('_'); 

            newState.messages.push({
              id: newState.nextMessageId++,
              type: 'private_message',
              senderId: sender.id,
              senderName: sender.username,
              receiverId: receiver.id,
              receiverName: receiver.username,
              roomId: dmRoomId, // The shared DM room ID
              content: data.content.trim(),
              timestamp: new Date().toISOString(),
            });
          }
          break;
        }

        case 'typing': {
          const client = newState.clients[senderSocketId];
          if (client) {
            client.isTyping = true;
            // Clear previous typing timeout
            clearTimeout(timeoutsRef.current[senderSocketId]);

            // Set a new timeout to stop typing after 2 seconds
            timeoutsRef.current[senderSocketId] = setTimeout(() => {
              setState(p => {
                const nextClients = { ...p.clients };
                if (nextClients[senderSocketId]) {
                  nextClients[senderSocketId] = { ...nextClients[senderSocketId], isTyping: false };
                }
                return { ...p, clients: nextClients };
              });
              delete timeoutsRef.current[senderSocketId];
            }, 2000); 
          }
          break;
        }

        default:
          console.warn(`Unknown server event: ${event}`);
      }

      // Cleanup typing timeout reference if necessary (though handled in 'typing' case)
      if (event !== 'typing' && timeoutsRef.current[senderSocketId]) {
        clearTimeout(timeoutsRef.current[senderSocketId]);
        delete timeoutsRef.current[senderSocketId];
      }
      
      return newState;
    });
  }, [broadcastNotification]);

  // Expose the necessary state and the handler
  return { serverState: state, handleServerEvent };
};

/**
 * Custom hook to simulate the client logic.
 * This hook is used inside the main App component.
 */
const useSocketClient = (handleServerEvent, username) => {
  const [socketId, setSocketId] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  
  // Simulated 'socket' object for sending events
  const socket = useMemo(() => ({
    emit: (event, data = {}) => {
      // Simulate network delay (optional, for realism)
      setTimeout(() => {
        handleServerEvent(event, data, socketId);
      }, 50); 
    },
    // The 'on' function is simulated by listening to the global serverState changes
  }), [handleServerEvent, socketId]);

  // Initial connection simulation
  useEffect(() => {
    if (username && !socketId) {
      const newSocketId = idGenerator(); // The client's unique connection ID
      setSocketId(newSocketId);
      setIsConnected(true);
      
      // Send the initial 'connect' event to the server
      socket.emit('connect', { username });

      // Simulate a disconnect on unmount (cleanup)
      return () => {
        socket.emit('disconnect');
        setIsConnected(false);
      };
    }
  }, [username, socketId, socket]); // Depend on username and socketId for connection logic

  // The client does not use 'on' because it reads directly from the serverState,
  // making the communication inherently real-time.

  return { socket, isConnected, socketId };
};

// --- Main React Application Component ---

const ChatApp = () => {
  const [username, setUsername] = useState('');
  const [authName, setAuthName] = useState('');
  const [currentRoom, setCurrentRoom] = useState(DEFAULT_ROOMS[0]);
  const [messageInput, setMessageInput] = useState('');
  const [isPrivateChat, setIsPrivateChat] = useState(false);
  const [dmTarget, setDmTarget] = useState(null); // {id, username}

  // Use the simulated server hook (handles all backend logic)
  const { serverState, handleServerEvent } = useSimulatedServer();

  // Initialize the client connection simulation
  const { socket, isConnected, socketId } = useSocketClient(handleServerEvent, authName);

  // Get the current client's data from the server state
  const currentClient = serverState.clients[socketId];

  // Ref for auto-scrolling
  const messagesEndRef = useRef(null);

  // --- Core Handlers ---

  const handleSetUsername = (e) => {
    e.preventDefault();
    if (username.trim()) {
      setAuthName(username.trim());
    }
  };

  const handleJoinRoom = (room) => {
    setCurrentRoom(room);
    setIsPrivateChat(false);
    setDmTarget(null);
    if (isConnected) {
      socket.emit('joinRoom', { roomId: room.id });
    }
  };

  const handleStartDM = (targetClient) => {
    // Cannot DM self
    if (targetClient.id === currentClient.id) return;
    
    // Set the target
    setDmTarget(targetClient);
    setIsPrivateChat(true);

    // DMs create a unique room ID based on both users' IDs
    const dmRoomId = [currentClient.id, targetClient.id].sort().join('_');
    setCurrentRoom({ id: dmRoomId, name: `@ ${targetClient.username}` });
  };

  const handleSendMessage = (e) => {
    e.preventDefault();
    if (!isConnected || messageInput.trim() === '') return;

    if (isPrivateChat && dmTarget) {
      socket.emit('privateMessage', { 
        receiverId: dmTarget.id, 
        content: messageInput 
      });
    } else {
      socket.emit('message', { 
        roomId: currentRoom.id, 
        content: messageInput 
      });
    }

    setMessageInput('');
  };

  const handleTyping = (e) => {
    setMessageInput(e.target.value);
    if (isConnected && e.target.value.length > 0) {
      socket.emit('typing');
    }
  };
  
  // --- Computed State & Effects ---

  // Filter messages for the current room/DM
  const currentRoomMessages = useMemo(() => {
    return serverState.messages.filter(msg => {
      // Direct Message logic
      if (isPrivateChat && dmTarget) {
        // DM messages are tagged with a specific sorted room ID
        const dmRoomId = [currentClient.id, dmTarget.id].sort().join('_');
        return msg.roomId === dmRoomId;
      }
      // Public Room logic
      return msg.roomId === currentRoom.id;
    });
  }, [serverState.messages, currentRoom.id, isPrivateChat, dmTarget, currentClient]);


  // Get users currently in the same public room
  const usersInCurrentRoom = useMemo(() => {
    if (isPrivateChat) return []; // DMs use the global user list
    return Object.values(serverState.clients).filter(
      client => client.currentRoomId === currentRoom.id
    );
  }, [serverState.clients, currentRoom.id, isPrivateChat]);

  // Get all online users (for DM list)
  const allOnlineUsers = useMemo(() => {
    return Object.values(serverState.clients).filter(c => c.socketId !== socketId);
  }, [serverState.clients, socketId]);

  // Get typing users in the same room (excluding self)
  const typingUsers = useMemo(() => {
    // Typing indicators are only shown for Public Rooms
    if (isPrivateChat) return [];

    return usersInCurrentRoom
      .filter(client => client.isTyping && client.socketId !== socketId)
      .map(client => client.username);
  }, [usersInCurrentRoom, socketId, isPrivateChat]);


  // Auto-scroll to the bottom of the message list
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [currentRoomMessages]);

  // --- UI Components ---

  const Sidebar = () => (
    <div className="flex flex-col h-full bg-gray-900 text-white p-4 shadow-xl">
      <h2 className="text-xl font-bold mb-4 border-b border-gray-700 pb-2">
        {authName}'s Chat Client
      </h2>
      
      {/* Public Rooms */}
      <div className="mb-6">
        <h3 className="text-sm font-semibold uppercase text-gray-400 mb-2">Public Channels</h3>
        {DEFAULT_ROOMS.filter(r => r.id !== 'global-broadcast').map(room => (
          <div
            key={room.id}
            onClick={() => handleJoinRoom(room)}
            className={`
              p-2 rounded-lg cursor-pointer transition-colors duration-150 flex justify-between items-center
              ${currentRoom.id === room.id && !isPrivateChat 
                ? 'bg-indigo-600 text-white font-semibold' 
                : 'hover:bg-gray-700 text-gray-200'
              }
            `}
          >
            {room.name}
            {/* Display count of users in room (Public only) */}
            <span className="text-xs font-mono opacity-70 bg-gray-800 px-2 py-0.5 rounded-full">
                {isPrivateChat ? 0 : Object.values(serverState.clients).filter(c => c.currentRoomId === room.id).length}
            </span>
          </div>
        ))}
      </div>

      {/* Direct Messages (Online Users) */}
      <div className="flex-1 overflow-y-auto">
        <h3 className="text-sm font-semibold uppercase text-gray-400 mb-2">Online Users ({allOnlineUsers.length})</h3>
        {allOnlineUsers.map(client => (
          <div
            key={client.id}
            onClick={() => handleStartDM(client)}
            className={`
              p-2 rounded-lg cursor-pointer transition-colors duration-150 flex items-center
              ${isPrivateChat && dmTarget?.id === client.id
                ? 'bg-purple-600 text-white font-semibold' 
                : 'hover:bg-gray-700 text-gray-200'
              }
            `}
          >
            <div className={`w-3 h-3 rounded-full mr-2 bg-green-500 border-2 border-green-300`}></div>
            <span className="truncate flex-1">{client.username}</span>
            <span className="text-xs text-purple-200 ml-2">(DM)</span>
          </div>
        ))}
      </div>
      
      <div className="mt-4 pt-4 border-t border-gray-700 text-xs text-gray-500 text-center">
          <p>Status: <span className="text-green-400 font-bold">Online</span></p>
          <p>Socket ID: <code className="text-gray-400">{socketId}</code></p>
      </div>
    </div>
  );

  const MessageBubble = ({ message }) => {
    const isSelf = message.senderId === currentClient?.id;
    const time = new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    if (message.type === 'notification') {
      return (
        <div className="text-center text-xs text-gray-500 my-3 italic">
          — {new Date(message.timestamp).toLocaleDateString()} —
          <br/>
          {message.content}
        </div>
      );
    }

    return (
      <div className={`flex my-3 ${isSelf ? 'justify-end' : 'justify-start'}`}>
        <div className={`max-w-xs md:max-w-md lg:max-w-lg p-3 rounded-2xl shadow-md transition duration-200 ${
          isSelf 
            ? 'bg-indigo-600 text-white rounded-br-none' 
            : 'bg-white text-gray-800 rounded-tl-none border border-gray-100'
        }`}>
          <div className={`font-bold text-sm mb-1 ${isSelf ? 'text-indigo-200' : 'text-indigo-600'}`}>
            {isSelf ? 'You' : message.senderName}
          </div>
          <p className="whitespace-pre-wrap">{message.content}</p>
          <div className={`text-xs mt-1 opacity-70 text-right ${isSelf ? 'text-indigo-300' : 'text-gray-500'}`}>
            {time}
          </div>
        </div>
      </div>
    );
  };

  const ChatWindow = () => (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header */}
      <div className="p-4 border-b border-gray-200 bg-white shadow-sm flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900 truncate">
          {isPrivateChat ? 
            <span className="text-purple-600">{currentRoom.name} (DM)</span> : 
            <span className="text-indigo-600">{currentRoom.name}</span>
          }
        </h2>
        {!isPrivateChat && (
          <div className="text-sm font-medium text-gray-600">
            {usersInCurrentRoom.length} Online
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar">
        <style jsx="true">{`
          .custom-scrollbar::-webkit-scrollbar {
            width: 8px;
          }
          .custom-scrollbar::-webkit-scrollbar-thumb {
            background-color: #cbd5e1; /* gray-300 */
            border-radius: 4px;
          }
          .custom-scrollbar::-webkit-scrollbar-track {
            background-color: #f3f4f6; /* gray-100 */
          }
        `}</style>
        {currentRoomMessages.map(msg => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Footer/Input Area */}
      <div className="p-4 border-t border-gray-200 bg-white">
        {typingUsers.length > 0 && (
          <div className="text-sm text-gray-500 mb-2 italic animate-pulse">
            {typingUsers.join(', ')} {typingUsers.length > 1 ? 'are' : 'is'} typing...
          </div>
        )}
        
        <form onSubmit={handleSendMessage} className="flex space-x-3">
          <input
            type="text"
            value={messageInput}
            onChange={handleTyping}
            placeholder={`Message ${currentRoom.name}...`}
            className="flex-1 p-3 border-2 border-gray-200 rounded-xl focus:outline-none focus:ring-4 focus:ring-indigo-200 transition duration-150"
            disabled={!isConnected}
          />
          <button
            type="submit"
            className="px-6 py-3 bg-indigo-600 text-white font-bold rounded-xl shadow-lg hover:bg-indigo-700 transition duration-300 transform hover:scale-[1.02] focus:outline-none focus:ring-4 focus:ring-indigo-300 disabled:opacity-50"
            disabled={!isConnected || messageInput.trim() === ''}
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );

  // --- Main Render ---
  if (!authName) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4 font-sans">
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap');body { font-family: 'Inter', sans-serif; }`}</style>
        <div className="max-w-md w-full bg-white p-8 rounded-2xl shadow-2xl">
          <h1 className="text-3xl font-extrabold text-gray-900 mb-6 text-center">
            Welcome to Real-Time Chat
          </h1>
          <form onSubmit={handleSetUsername} className="space-y-4">
            <label htmlFor="username" className="block text-sm font-medium text-gray-700">
              Enter your Username
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g., JaneDoe88"
              required
              className="w-full p-3 border-2 border-gray-300 rounded-xl focus:outline-none focus:ring-4 focus:ring-indigo-300 transition duration-150 text-lg"
            />
            <button
              type="submit"
              className="w-full px-4 py-3 bg-indigo-600 text-white font-bold rounded-xl shadow-lg hover:bg-indigo-700 transition duration-300 transform hover:scale-[1.01] focus:outline-none focus:ring-4 focus:ring-indigo-300"
            >
              Start Chatting
            </button>
          </form>
          <p className="mt-6 text-center text-sm text-gray-500">
            A real-time simulation powered by Socket.IO principles.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 font-sans p-0 md:p-8">
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap');body { font-family: 'Inter', sans-serif; }`}</style>
      <div className="max-w-full xl:max-w-7xl mx-auto h-screen-minus-padding md:h-[90vh] shadow-2xl rounded-none md:rounded-3xl overflow-hidden flex flex-col md:flex-row">
        
        {/* Sidebar (Rooms and Users) */}
        <div className="w-full md:w-1/4 h-2/5 md:h-full border-b md:border-r border-gray-700">
          <Sidebar />
        </div>

        {/* Chat Window */}
        <div className="w-full md:w-3/4 h-3/5 md:h-full">
          <ChatWindow />
        </div>
      </div>
    </div>
  );
};

// We wrap the entire application in a component that includes the Tailwind script
const AppWrapper = () => (
    <>
        <script src="https://cdn.tailwindcss.com"></script>
        <ChatApp />
    </>
);

export default AppWrapper;