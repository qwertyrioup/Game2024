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
let userQueue = [];
let lastUserConnectTime = null;
let cleanupTimer = null;
let rooms = [];
let botAdditionInterval;
const botAwaitTime = 2000;

// Color and type mappings
const colorMapping = ["blue", "red", "green", "yellow"];
const typeMapping = ["real", "real", "real", "real"]; // Assuming all users are real by default

// Variable to keep track of the current turn index
let currentTurnIndex = 0;

// Function to get the next player's color and increment the turn index
function getNextPlayerColor() {
  const playerColors = ["blue", "red", "green", "yellow"];
  const nextColor = playerColors[currentTurnIndex];
  currentTurnIndex = (currentTurnIndex + 1) % playerColors.length; // Loop back to 0 if reached the end
  return nextColor;
}

// Function to roll a dice and return the turn player's color and a random number between 1 and 6
function rollDice() {
  // Get the current turn player
  const currentPlayer = userQueue[0]; // Assuming userQueue contains players in the current turn order

  // Generate a random number between 1 and 6
  const randomNumber = Math.floor(Math.random() * 6) + 1;

  return { color: currentPlayer.color, number: randomNumber };
}

// Middleware function to authenticate socket connections
io.use((socket, next) => {
  const accessToken = socket.handshake.headers.authorization;

  if (accessToken) {
    const token = accessToken.split(" ")[1]; // Split "Bearer token" and take the token part
    jwt.verify(token, process.env.JWT_SEC, (err, decoded) => {
      if (err) return next(new Error("Authentication error"));
      socket.decoded = decoded;
      next();
    });
  } else {
    next(new Error("Authentication error"));
  }
});

io.on("connection", (socket) => {
  lastUserConnectTime = Date.now();

  const userIndex = userQueue.length % colorMapping.length;
  const color = colorMapping[userIndex];
  const type = typeMapping[userIndex];

  const pieces = [];
  for (let i = 1; i <= 4; i++) {
    pieces.push({ name: `${color}${i}`, state: "locked", position: null });
  }
  userQueue.push({
    username: socket.decoded.username,
    balance: socket.decoded.balance,
    role: socket.decoded.role,
    type,
    color,
    socket,
    pieces,
    dice: 6,
  });

  // Check if at least one user is connected
  if (userQueue.length === 1) {
    // Start a timer to wait for 30 seconds for another user to join
    setTimeout(() => {
      // Check if there are still less than 4 users after 30 seconds
      if (userQueue.length < 4) {
        // Add a bot
        addBots();
      } else {
        // Start the game if there are 4 users
        startGame();
      }
    }, botAwaitTime);
  }

  // Check if there are four users connected
  if (userQueue.length === 4) {
    // Clear the bot addition interval
    clearInterval(botAdditionInterval);

    // Start the game
    startGame();
  }
});

// Function to add bots to the queue
function addBots() {
  if (userQueue.length < 4) {
    const botColor = colorMapping[userQueue.length];
    const botPieces = [];
    for (let j = 1; j <= 4; j++) {
      botPieces.push({
        name: `${botColor}${j}`,
        state: "locked",
        position: null,
      });
    }

    userQueue.push({
      username: `Bot-${userQueue.length}`,
      type: "bot",
      color: botColor,
      socket: null,
      pieces: botPieces,
      dice: 6,
    });
    // console.log("bot added");
    if (userQueue.length < 4) {
      // Start a timer to wait for another 30 seconds
      setTimeout(() => {
        // Check if there are still less than 4 players after 30 seconds
        if (userQueue.length < 4) {
          // Add another bot
          addBots();
        } else {
          // Start the game if there are 4 players
          startGame();
        }
      }, botAwaitTime);
    } else {
      // Start the game if there are 4 players
      startGame();
    }
  }
}

function startGame() {
  //   console.log("userQueue", userQueue);
  // Sort userQueue based on color order
  userQueue.sort((a, b) => {
    return colorMapping.indexOf(a.color) - colorMapping.indexOf(b.color);
  });

  // Assign turns based on color order
  userQueue.forEach((player, index) => {
    player.turn = index + 1;
  });

  // Emit game start event to all players
  const roomId = uuid();
  const players = userQueue.map((player) => ({
    username: player.username,
    color: player.color,
    turn: player.turn,
    type: player.type,
    balance: player?.balance,
    pieces: player.pieces,
    dice: player.dice,
  }));
  const generatedRoom = { roomId, players };
  rooms.push(generatedRoom);
  userQueue.forEach((player) => {
    if (player.type !== "bot") {
      player.socket.join(roomId); // Each player joins a room identified by roomId
      player.socket.emit("game-start", generatedRoom);
    }
  });

  // Clear userQueue
  userQueue = [];

  // Start the turn loop
  startTurnLoop(generatedRoom);
}

function startTurnLoop(room) {
  // Start the turn loop
  setInterval(() => {
    // Get the next player's color
    const nextPlayer = room.players[0];

    // Roll the dice for the next player
    nextPlayer.dice = Math.floor(Math.random() * 6) + 1;

    // io.emit("game-update", {
    //   playerColor: nextPlayer.color,
    //   diceResult: nextPlayer.dice,
    // });
    // Emit turn start event with player's color and dice result, but only for real players

    io.to(room.roomId).emit("game-update", {
        playerColor: nextPlayer.username,
        diceResult: nextPlayer.dice,
      });
    // Rotate the player queue
    room.players.push(room.players.shift());

    io.to(room.roomId).emit("update room", room);

    // Emit updated room object to all users
    // io.emit("update room", room);
    console.log("emitted");
  }, 2000); // Roll dice every 10 seconds
}

// Function to check and clear states if no user connects for 1 minute
function checkAndClearStates() {
  const currentTime = Date.now();
  if (currentTime - lastUserConnectTime >= 60000) {
    console.log("No users connected for 1 minute. Clearing states.");
    userQueue = [];
    lastUserConnectTime = null;
    clearTimeout(cleanupTimer);
    cleanupTimer = null;
  } else {
    cleanupTimer = setTimeout(checkAndClearStates, 60000);
  }
}

// Start the server
const PORT = process.env.PORT || 9000;

httpServer.listen(process.env.PORT, () => {
  MongoDbConnection();

  console.log("Server started on Port", process.env.PORT);
});
