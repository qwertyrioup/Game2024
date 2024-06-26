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
let manualDice = false; // Flag to control dice emission during manual player action


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
  console.log("new connection");

  setupUserLevel(myId, connectedUsers, levels, runningGames);

  findGame(myId, levels, runningGames);


  socket.on("player-action", (actionObj) => {
      const { action, color, id } = actionObj;
  
      let foundRoom = runningGames.get(id);
      if (foundRoom) {
          const turn = foundRoom.turn;
  
          if (action === "roll" && foundRoom && turn === color) {
              if (!foundRoom.turnProcessed) {
                  const dice = rollDice();
                  const nextTurn = passTurn(turn);
                  foundRoom.turn = nextTurn;
                  foundRoom.turnProcessed = true; // Mark the turn as processed
                  io.to(id).emit("dice", dice); // Emit the dice roll result to the room
                  runningGames.set(id, foundRoom);
                  manualDice = true; // Set flag to indicate manual dice emission
              } else {
                  console.log("Turn already processed.");
              }
          } else {
              // console.log("Invalid player or not player's turn.");
          }
      } else {
          console.log("room not found");
      }
  });

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
      //   actual connected users ${levels.bronze.length}
      // );

      break;
    case "silver":
      pushToLevel(id, levels.silver);
      // userSocket.emit(
      //   "status",
      //   actual connected users ${levels.silver.length}
      // );
      break;
    case "gold":
      pushToLevel(id, levels.gold);
      // userSocket.emit("status", actual connected users ${levels.gold.length});
      break;
    case "diamond":
      pushToLevel(id, levels.diamond);
      // userSocket.emit(
      //   "status",
      //   actual connected users ${levels.diamond.length}
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
        // userSocket.emit("status", actual connected users ${players.length});

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
  console.log("roomId", roomId);
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
    turn: "blue",
    turnProcessed: false,
  });

  targetRoom = runningGames.get(roomId);
  // userSocket.emit("game", targetRoom);
  targetRoom.players.forEach((player) => {
    if (player.type === "real") {
      const playerSocket = connectedUsers.get(player.id);
      playerSocket.join(roomId);
    }
  });
  console.log("game run");
  playGame(roomId, targetRoom);
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

function passTurn(turn) {
  let nextTurn;
  if (turn === "blue") {
    nextTurn = "red";
  } else if (turn === "red") {
    nextTurn = "green";
  } else if (turn === "green") {
    nextTurn = "yellow";
  } else if (turn === "yellow") {
    nextTurn = "blue";
  }
  return nextTurn;
}

function playGame(roomId, targetRoom) {
  const room = targetRoom;

  io.to(roomId).emit("status", "starting game");

  function playTurn() {
      const turn = room.turn; // Get the current player
      const nextTurn = passTurn(turn);
      io.to(roomId).emit("turn", turn); // Emit the turn event for the current player
      console.log("turn", turn);
      console.log("nextTurn", nextTurn);
      setTimeout(() => {
          if (!manualDice) { // Check if manual dice emission is not flagged
              const dice = rollDice();
              room.turn = nextTurn;
              room.turnProcessed = false;
              runningGames.set(roomId, room);
              io.to(roomId).emit("dice", dice);
              console.log("auto dice", dice);
          }
          manualDice = false; // Reset flag after using it
      }, 10000);

      // Emit the turn event for the current player
      setTimeout(playTurn, 20000); // Start the game loop
  }

  if (!room.turnProcessed) {
      playTurn(); // Start the game loop
  }
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
