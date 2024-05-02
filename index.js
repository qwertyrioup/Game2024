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



// Middleware function to authenticate socket connections
io.use((socket, next) => {
  const accessToken = socket.handshake.headers.authorization;

  if (accessToken) {
    const token = accessToken.split(" ")[1]; // Split "Bearer token" and take the token part
    jwt.verify(token, process.env.JWT_SEC, (err, decoded) => {
      if (err) return next(new Error("Authentication error"));
      socket.user = decoded;
      console.log('decoded: ', decoded)
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
    username: socket.user.username,
    balance: socket.user.balance,
    role: socket.user.role,
    level: socket.user.level,
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
        startGame(socket);
      }
    }, botAwaitTime);
  }

  // Check if there are four users connected
  if (userQueue.length === 4) {
    // Clear the bot addition interval
    // clearInterval(botAdditionInterval);

    // Start the game
    startGame(socket);
  }

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
            startGame(socket);
          }
        }, botAwaitTime);
      } else {
        // Start the game if there are 4 players
        startGame(socket);
      }
    }
  }

  function startGame(socket) {
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
      level: player?.level,
      pieces: player.pieces,
      dice: player.dice,
      // socket
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
    startTurnLoop(generatedRoom, socket);
  }

  function startTurnLoop(room, socket) {
    let actionTimeout;
    let currentPlayer;

    // Start the turn loop
    function handleNextTurn(socket) {




      if (room.players.length === 0) {
        console.log("No players left in the room.");
        return; // Exit if no players are in the room
      }

      // Get the current player
      currentPlayer = room.players[0]; // Assign currentPlayer here

      io.to(room.roomId).emit("turn", {
        color: currentPlayer.color,
      });

      // console.log("works");
      // console.log(`It's now ${currentPlayer.username}'s turn.`);
      // Set a timeout for player action
      actionTimeout = setTimeout(() => {
        // console.log(`No action from ${currentPlayer.username}, rolling the dice automatically.`);
        // If no action is taken, roll the dice automatically
        const rolledDice = Math.floor(Math.random() * 6) + 1;
        currentPlayer.dice = rolledDice;

        // Emit event with dice result
        io.to(room.roomId).emit("dice", {
          dice: rolledDice,
        });

        // Rotate to next player
        passTurnToNextPlayer(socket);
      }, 15000); // 15 seconds timeout
    }

    // Setup listener for player action outside of handleNextTurn
    socket.on("player-action", (actionData) => {
      if (
        currentPlayer.color === actionData.color &&
        actionData.action === "roll"
      ) {
        clearTimeout(actionTimeout); // Clear the action timeout
        handlePlayerAction(currentPlayer, socket);

        console.log("Rolled !");
      } else {
        console.log("Not your turn.");
      }
    });

    // Function to pass turn to the next player
    function passTurnToNextPlayer(socket) {
      // Move to the next player
      // room.currentTurnIndex = (room.currentTurnIndex + 1) % room.players.length;
      room.players.push(room.players.shift());
      handleNextTurn(socket); // Call the next turn
    }

    // Function to handle player action
    function handlePlayerAction(player, socket) {
      const rolledDice = Math.floor(Math.random() * 6) + 1;
      player.dice = rolledDice;
      io.to(room.roomId).emit("dice", {
        dice: rolledDice,
      });
      passTurnToNextPlayer(socket);

      // Emit updated room object to all users
      io.to(room.roomId).emit("update-room", room);
    }

    // Start the turn loop
    handleNextTurn(socket);
  }
});

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

httpServer.listen(PORT, () => {
  MongoDbConnection();
  console.log("Server started on Port", process.env.PORT);
  checkAndClearStates();
});
