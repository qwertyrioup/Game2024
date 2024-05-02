import http, { createServer } from "http";
import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import url from "url";
import { uuid } from "uuidv4";
import authRoutes from "./routes/auth.js";
import dotenv from "dotenv";
import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import { MongoDbConnection } from "./config/conn.js";
import { type } from "os";

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*", // Adjust according to your frontend's URL to restrict origins
    methods: ["GET", "POST"],
  },
});

app.use(cors());
app.use(express.json({ limit: "512mb" }));

// app.use(cookieParser());
app.use(express.urlencoded({ extended: false }));
dotenv.config();
mongoose.set("strictQuery", false);

app.use("/api/auth", authRoutes);

// Queue for users waiting to join the game
const connectedUsers = new Map();
const runningGames = new Map();

let lastUserConnectTime = null;
let cleanupTimer = null;
const levels = {
  bronze: [],
  silver: [],
  gold: [],
  diamond: [],
};

const botAwaitTime = 5000;
const rollingDiceAwaitTime = 5000;
const movePieceAwaitingTime = 5000;

// Color and type mappings
const colorMapping = ["blue", "red", "green", "yellow"];
// Middleware function to authenticate socket connections
io.use((socket, next) => {
  const accessToken = socket.handshake.headers.authorization;

  if (accessToken) {
    const token = accessToken.split(" ")[1]; // Split "Bearer token" and take the token part
    jwt.verify(token, process.env.JWT_SEC, (err, decoded) => {
      if (err) return next(new Error("Authentication error"));
      socket.user = decoded;
      connectedUsers.set(decoded.id, socket);
      next();
    });
  } else {
    next(new Error("Authentication error"));
  }
});

io.on("connection", (socket) => {
  const myId = socket.user.id.toString();

  setupUserLevel(myId, connectedUsers, levels, runningGames);

  findGame(myId, levels, runningGames);

  socket.on("disconnect", () => {
    if (socket.user) {
      const { id, level } = socket.user;
      removeLevelPlayer(id, level);
      connectedUsers.delete(id);
    }
  });
});

function setupUserLevel(userId, connectedUsers, levels, runningGames) {
  if (isPlayerInRunningGame(userId, runningGames)) {
    return; // Exit if player is in a running game
  }

  const userSocket = connectedUsers.get(userId);

  // Check if the user socket exists
  if (!userSocket) {
    console.error("User socket not found for ID:", userId);
    return; // Exit if no user socket found
  }

  const user = userSocket.user;
  if (!user) {
    console.error("User data not found in socket for ID:", userId);
    return; // Exit if user data is missing
  }

  const { level, username, id, balance } = user;

  // Notify the user of successful connection

  // Depending on the user's level, push to the appropriate level array and emit the updated level array to the user
  switch (level) {
    case "bronze":
      pushToLevel(id, levels.bronze);
      // userSocket.emit(
      //   "status",
      //   `actual connected users ${levels.bronze.length}`
      // );

      break;
    case "silver":
      pushToLevel(id, levels.silver);
      // userSocket.emit(
      //   "status",
      //   `actual connected users ${levels.silver.length}`
      // );
      break;
    case "gold":
      pushToLevel(id, levels.gold);
      // userSocket.emit("status", `actual connected users ${levels.gold.length}`);
      break;
    case "diamond":
      pushToLevel(id, levels.diamond);
      // userSocket.emit(
      //   "status",
      //   `actual connected users ${levels.diamond.length}`
      // );

      break;
    default:
      console.error("Unrecognized user level:", level);
  }

  // userSocket.emit("status", levels[level].length);
}

function findGame(userId, levels, runningGames) {
  if (isPlayerInRunningGame(userId, runningGames)) {
    return; // Exit if player is in a running game
  }

  let addingBotsInterval;
  const userSocket = connectedUsers.get(userId);

  for (const level in levels) {
    const players = levels[level];

    if (players.length >= 1 && players.length < 4) {
      // Start waiting for players to join
      addingBotsInterval = setInterval(() => {
        // Check if any new players joined during the waiting time
        if (players.length < 4) {
          // Add a bot if no new players joined
          players.push("bot");
        }

        // Emit status to connected users
        // userSocket.emit("status", `actual connected users ${players.length}`);

        // Launch the game if there are 4 players (including bots)
        if (players.length === 4) {
          clearInterval(addingBotsInterval);
          launchGame(userId, players, level, levels, runningGames);
        }
      }, botAwaitTime);
    }
  }
}

function launchGame(userId, players, level, levels, runningGames) {
  const roomId = uuid();
  const gamePlayers = players.slice(0, 4); // Take the first four players

  // Remove these players from the level array
  levels[level] = players.slice(4);

  runningGames.set(roomId, { players: gamePlayers, level: level });

  // Now you can start a game with these players
  const gameRoom = { roomId, players: gamePlayers, level: level };

  startGame(userId, gameRoom);
}

function isPlayerInRunningGame(playerToCheck, runningGames) {
  for (const [roomId, game] of runningGames.entries()) {
    for (const player of game.players) {
      if (player.id === playerToCheck) {
        console.log(
          `${playerToCheck} is already in a running game with room ID ${roomId}`
        );
        return true; // Player is already in a running game
      }
    }
  }
  return false; // Player is not in any running game
}

function startGame(userId, room) {
  const userSocket = connectedUsers.get(userId);
  let targetRoom;
  // Here you can implement your game logic
  const { roomId, players, level } = room;
  let botCounter = 1; // Counter to keep track of bot numbering

  const generatedPlayers = players.map((player, index) => {
    if (player.includes("bot")) {
      const botName = `bot${botCounter++}`; // Increment bot counter for each bot encountered
      return {
        username: botName,
        type: "bot",
        color: colorMapping[index % colorMapping.length],
      }; // Assign colors based on the color mapping
    } else {
      const connectedUser = connectedUsers.get(player);
      return {
        id: connectedUser.user.id,
        username: connectedUser.user.username,
        type: "real",
        color: colorMapping[index % colorMapping.length],
      };
    }
  });

  const generatedPlayersWithPieces = generatedPlayers.map((player) => {
    const pieces = [];
    for (let i = 1; i <= 4; i++) {
      pieces.push({
        name: `${player.color}${i}`,
        state: "locked",
        position: null,
      });
    }
    return { ...player, pieces };
  });

  runningGames.set(roomId, {
    players: generatedPlayersWithPieces,
    level,
    dice: 6,
  });


  targetRoom = runningGames.get(roomId);
  userSocket.emit("game", targetRoom);
  playGame(userId, roomId);

  // setTimeout(() => {
  //   userSocket.emit("status", "generating room.");
  // }, 2500);
  // setTimeout(() => {
  //   userSocket.emit("status", "room generated.");
  // }, 5000);
  // setTimeout(() => {
  //   userSocket.emit("status", "game starting in 5s.");
  //   targetRoom = runningGames.get(roomId);
  // }, 7500);
  // setTimeout(() => {
  //   userSocket.emit("status", "game started.");
  //   userSocket.emit("game", targetRoom);
  //   playGame(userId, roomId);
  // }, 12500);
}

function pushToLevel(id, array) {
  if (!array.includes(id)) {
    array.push(id);
  }
}

function removeLevelPlayer(id, level) {
  const levelArray = levels[level];
  if (levelArray) {
    const index = levelArray.indexOf(id);
    if (index > -1) {
      levelArray.splice(index, 1);
    }
  }
}

function checkAndClearStates() {
  const currentTime = Date.now();
  if (currentTime - lastUserConnectTime >= 60000) {
    console.log("No users connected for 1 minute. Clearing states.");
    lastUserConnectTime = null;
    clearTimeout(cleanupTimer);
    cleanupTimer = null;
  } else {
    cleanupTimer = setTimeout(checkAndClearStates, 60000);
  }
}

function playGame(userId, roomId) {
  const room = runningGames.get(roomId);
  const userSocket = connectedUsers.get(userId);
  let canRollDice = false
  // const playerIds = room.players
  //   .map((player) => {
  //     if (player.type === "real") {
  //       return player.id;
  //     }
  //   })
  //   .filter((playerId) => playerId !== undefined);

  //   playerIds.forEach((playerId) => {
  //     const playerSocket = connectedUsers.get(playerId)
  //     playerSocket.join(roomId)

    // })

  let currentIndex = 0;
  let actionTimeout;
  let generatedDice;

  function waitForPlayerAction(userSocket, currentPlayerColor) {
    return new Promise((resolve) => {
      userSocket.once("player-action", (actionData) => {
        resolve(actionData);
      });
    });
  }

  function playTurn() {
    const currentPlayer = room.players[currentIndex];
    // console.log(`It's ${currentPlayer.username}'s turn.`);
    setTimeout(() => {
   
        userSocket.emit("turn", currentPlayer.color);
        canRollDice = true
     
    }, movePieceAwaitingTime);

    // Set timeout for player action
    actionTimeout = setTimeout(() => {
      generatedDice = rollDice();
      
      currentIndex = (currentIndex + 1) % room.players.length;
      userSocket.emit("dice", generatedDice);
      canRollDice = false;
 
      playTurn(); // Proceed to the next turn
    }, rollingDiceAwaitTime * 2);

    // Wait for player action
    waitForPlayerAction(userSocket, currentPlayer.color).then((actionData) => {
      // If player action is 'roll' and it's the current player's turn
      if (
        actionData.action === "roll" &&
        actionData.color === currentPlayer.color && canRollDice
      ) {
        clearTimeout(actionTimeout);
        generatedDice = rollDice();
        currentIndex = (currentIndex + 1) % room.players.length;
        userSocket.emit("dice", generatedDice);
        canRollDice = false
        playTurn(); // Proceed to the next turn
      } else {
        console.log("Not your turn or invalid action.");
      }
    });
  }

  playTurn(); // Start the game loop
}

function rollDice() {
  return Math.floor(Math.random() * 6) + 1;
}

// Start the server
const PORT = process.env.PORT || 9000;

httpServer.listen(PORT, () => {
  MongoDbConnection();
  console.log("Server started on Port", process.env.PORT);
  checkAndClearStates();
});