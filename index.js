import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import cors from "cors";
import dotenv from "dotenv";
import { createServer } from "http";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { Server } from "socket.io";
import { v4 as uuidv4 } from 'uuid';
import { MongoDbConnection } from "./config/conn.js";
import authRoutes from "./routes/auth.js";

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
app.use(cors());
app.use(express.json());

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
const basePath = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56]
const bluePath = ['6B', '6C', '6D', '6E', '6F', '5G', '4G', '3G', '2G', '1G', '0G', '0H', '0I', '1I', '2I', '3I', '4I', '5I', '6J', '6K', '6L', '6M', '6N', '6O', '7O', '8O', '8N', '8M', '8L', '8K', '8J', '9I', '10I', '11I', '12I', '13I', '14I', '14H', '14G', '13G', '12G', '11G', '10G', '9G', '8F', '8E', '8D', '8C', '8B', '8A', '7A', '7B', '7C', '7D', '7E', '7F', '7G']
const redPath = ['1I', '2I', '3I', '4I', '5I', '6J', '6K', '6L', '6M', '6N', '6O', '7O', '8O', '8N', '8M', '8L', '8K', '8J', '9I', '10I', '11I', '12I', '13I', '14I', '14H', '14G', '13G', '12G', '11G', '10G', '9G', '8F', '8E', '8D', '8C', '8B', '8A', '7A', '6A', '6B', '6C', '6D', '6E', '6F', '5G', '4G', '3G', '2G', '1G', '0G', '0H', '1H', '2H', '3H', '4H', '5H', '6H']
const greenPath = ['8N', '8M', '8L', '8K', '8J', '9I', '10I', '11I', '12I', '13I', '14I', '14H', '14G', '13G', '12G', '11G', '10G', '9G', '8F', '8E', '8D', '8C', '8B', '8A', '7A', '6A', '6B', '6C', '6D', '6E', '6F', '5G', '4G', '3G', '2G', '1G', '0G', '0H', '0I', '1I', '2I', '3I', '4I', '5I', '6J', '6K', '6L', '6M', '6N', '6O', '7O', '7N', '7M', '7L', '7K', '7J', '7I']
const yellowPath = ['13G', '12G', '11G', '10G', '9G', '8F', '8E', '8D', '8C', '8B', '8A', '7A', '6A', '6B', '6C', '6D', '6E', '6F', '5G', '4G', '3G', '2G', '1G', '0G', '0H', '0I', '1I', '2I', '3I', '4I', '5I', '6J', '6K', '6L', '6M', '6N', '6O', '7O', '8O', '8N', '8M', '8L', '8K', '8J', '9I', '10I', '11I', '12I', '13I', '14I', '14H', '13H', '12H', '11H', '10H', '9H', '8H']

// Color and type mappings
const colorMapping = ["blue", "red", "green", "yellow"];


wss.on('connection', (ws, req) => {

  // const accessToken = req.headers.authorization;
  const accessToken = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY2MzAwMWMyYWI4MTQ0ZTk4YjRmZjJiOCIsInJvbGUiOiJjbGllbnQiLCJ1c2VybmFtZSI6ImJvJCQiLCJiYWxhbmNlIjowLCJsZXZlbCI6ImJyb256ZSIsImlhdCI6MTcxNzQ1MTY3OCwiZXhwIjoxNzE3NDYyNDc4fQ.velBtByx2cSNZqZTkxtp1ZJOjUCcSySavfJ2G8ro51M'

  if (accessToken) {

    const token = accessToken.split(" ")[1]; // Split "Bearer token" and take the token part
    jwt.verify(token, process.env.JWT_SEC, (err, decoded) => {
      if (err) {
        // Authentication error
        ws.close(1008, 'Authentication error');
        return;
      }
      // Authentication successful, attach user information to the WebSocket instance
      ws.user = decoded;
      connectedUsers.set(decoded.id, ws);

    });
  } else {
    // No access token provided
    ws.close(1008, 'Authentication error');
    return;
  }

  const myId = ws.user?.id.toString();
  console.log('new connection')


  setupUserLevel(myId, connectedUsers, levels, runningGames);

  findGame(myId, levels, runningGames);



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
  const roomId = uuidv4();
  // console.log('roomId', roomId)
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
        id: uuidv4(),
        username: botName,
        type: "bot",
        color: colorMapping[index % colorMapping.length],
        roomId: roomId
      }; // Assign colors based on the color mapping
    } else {
      const connectedUser = connectedUsers.get(player);
      return {
        id: connectedUser.user.id,
        username: connectedUser.user.username,
        type: "real",
        color: colorMapping[index % colorMapping.length],
        roomId: roomId
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
    turn: 'blue',
  });


  targetRoom = runningGames.get(roomId);
  // userSocket.emit("game", targetRoom);
  targetRoom.players.forEach((player) => {
    if (player.type === 'real') {
      const playerSocket = connectedUsers.get(player.id);
      if (playerSocket) {
        playerSocket.user.roomId = roomId;
        connectedUsers.set(player.id, playerSocket);
        playerSocket.send(JSON.stringify({ event: "my-color", message: player.color }));
        playerSocket.send(JSON.stringify({ event: "status", message: "starting game" }));
      }
    }
  });




  // Emit messages to real players in the room

  // io.to(roomId).emit("status", "starting game");

  playGame(roomId);

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
  let nextTurn
  if (turn === 'blue') {
    nextTurn = 'red'
  }
  else if (turn === 'red') {
    nextTurn = 'green'

  }
  else if (turn === 'green') {
    nextTurn = 'yellow'

  }
  else if (turn === 'yellow') {
    nextTurn = 'blue'

  }
  return nextTurn
}

function playGame(roomId) {
  let rollTimeOut = null; // Initialize rollTimeOut to null

  const room = runningGames.get(roomId);
  const turn = room.turn;
  const allPlayers = room.players;
  const currentPlayer = room.players.find((player) => player.color === turn);
  const otherPlayers = room.players.filter((player) => player.color !== turn);
  const playerPieces = currentPlayer.pieces;
  const nextTurn = passTurn(turn);

  const message = { event: "turn", message: turn };
  console.log("turn : ", turn)
  emitToRoomPlayers(roomId, message);

  if (currentPlayer.type === "real") {
    const playerSocket = connectedUsers.get(currentPlayer.id);

    // Define the roll event listener function
    const rollEventListener = (event) => {
      try {
        const actionObj = JSON.parse(event.data);
        console.log(actionObj)
        if (turn === actionObj.message && actionObj.event === "roll") {
          // Remove the event listener
          playerSocket.removeEventListener("message", rollEventListener);
          clearTimeout(rollTimeOut);
          handleRollAction(roomId, room, playerSocket, currentPlayer, playerPieces, nextTurn, otherPlayers);
        }
      } catch (error) {
        console.error('Error processing roll action:', error);
      }
    };

    // Add the event listener for roll actions
    playerSocket.addEventListener("message", rollEventListener);

    // Set the timeout to remove the event listener if no action is received
    rollTimeOut = setTimeout(() => {
      // Remove the event listener
      playerSocket.removeEventListener("message", rollEventListener);
      handleRollAction(roomId, room, playerSocket, currentPlayer, playerPieces, nextTurn, otherPlayers);
    }, rollingDiceAwaitTime);


  } else if (currentPlayer.type === "bot") {
    handleBotTurn(roomId, room, nextTurn);
  }
}


function emitToRoomPlayers(roomId, message) {
  const room = runningGames.get(roomId);
  if (!room) {
    console.error(`Room with ID ${roomId} not found.`);
    return;
  }

  room.players.forEach((player) => {
    if (player.type === 'real') {
      const playerSocket = connectedUsers.get(player.id);
      if (playerSocket) {
        playerSocket.send(JSON.stringify(message));
      }
    }
  });
}



// function handleRollAction(roomId, room, playerSocket, currentPlayer, playerPieces, nextTurn, otherPlayers) {
//   let moveTimeOut;
//   // const dice = rollDice();
//   const dice = 6;
//   room.dice = dice;
//   runningGames.set(roomId, room);
//   const message = { event: "dice", message: dice };
//   console.log('dice', dice)
//   emitToRoomPlayers(roomId, message);

//   const canMove = canPlay(playerPieces, dice);

//   if (canMove) {
//     const moveEventListener = (event) => {
//       try {
//         const actionObj = JSON.parse(event.data);
//         console.log(actionObj)
//         if (actionObj.event === "move") {
//           const targetPawn = actionObj.piece;
//           if (canMovePiece(playerPieces, targetPawn, dice)) {
//             playerSocket.removeEventListener("message", moveEventListener);
//             clearTimeout(moveTimeOut);
//             const { pieces, updatedOthers, kill } = changePiecePosition(playerPieces, targetPawn, dice, otherPlayers);
//             if (pieces !== null) {
//               const updatedPlayer = { ...currentPlayer, pieces: pieces };
//               const mergedPlayers = [updatedPlayer, ...updatedOthers];
//               console.log(mergedPlayers)
//               room.players = mergedPlayers;
//               if (dice !== 6 || !kill) {
//                 room.turn = nextTurn;
//               }
//               runningGames.set(roomId, room);
//               playGame(roomId);
//             }
//           }
//         }
//       } catch (error) {
//         console.error('Error processing move action:', error);
//       }
//     };

//     playerSocket.addEventListener('message', moveEventListener);

//     moveTimeOut = setTimeout(() => {
//       playerSocket.removeEventListener('message', moveEventListener);
//       const selectedPawn = autoSelectPiece(playerPieces);
//       const { pieces, updatedOthers, kill } = changePiecePosition(playerPieces, selectedPawn, dice, otherPlayers);
//       if (pieces !== null) {
//         const updatedPlayer = { ...currentPlayer, pieces: pieces };
//         const mergedPlayers = [updatedPlayer, ...updatedOthers];
//         room.players = mergedPlayers;
//         // mergedPlayers.forEach((player) => {
//         //   player.pieces.forEach((piece) => console.log(piece));
//         // });
//         // console.log('\n');
//         if (dice !== 6 || !kill) {
//           room.turn = nextTurn;
//         }
//         runningGames.set(roomId, room);
//         playGame(roomId);
//       }
//     }, movePieceAwaitingTime);
//   } else {
//     room.turn = nextTurn;
//     runningGames.set(roomId, room);
//     setTimeout(() => {

//       playGame(roomId);
//     }, 2500);
//   }
// }

function handleRollAction(roomId, room, playerSocket, currentPlayer, playerPieces, nextTurn, otherPlayers) {
  let moveTimeOut;
  // Simulate dice roll or use a function to get dice value.
  const dice = rollDice(); // Assuming rollDice is a function to roll the dice.
  // const dice = 6 // Assuming rollDice is a function to roll the dice.
  room.dice = dice;
  runningGames.set(roomId, room);
  const message = { event: "dice", message: dice };
  // console.log('dice', dice)
  emitToRoomPlayers(roomId, message);

  const canMove = canPlay(playerPieces, dice);
  if (canMove) {
    const moveEventListener = (event) => {
      try {
        const actionObj = JSON.parse(event.data);
        console.log(actionObj)
        if (actionObj.event === "move") {
          const targetPawn = actionObj.piece;
          if (canMovePiece(playerPieces, targetPawn, dice)) {
            playerSocket.removeEventListener("message", moveEventListener);
            clearTimeout(moveTimeOut);
            const { pieces, updatedOthers, kill, newPosition } = changePiecePosition(playerPieces, targetPawn, dice, otherPlayers);
            if (pieces !== null) {
              const updatedPlayer = { ...currentPlayer, pieces: pieces };
              const mergedPlayers = [updatedPlayer, ...updatedOthers];
              console.log(mergedPlayers.map(p =>
                p.pieces
              ))
              room.players = mergedPlayers;
              if (dice !== 6 || kill) { // Continue the turn if dice is 6 unless there is a kill
                room.turn = nextTurn;
              }
              runningGames.set(roomId, room);
              const message = { event: "map", message: JSON.stringify(mergedPlayers.map(p =>
                p.pieces
              )) };
              emitToRoomPlayers(roomId, message);
              setTimeout(() => {
                playGame(roomId);

              }, 2000);
            }
          }
        }
      } catch (error) {
        console.error('Error processing move action:', error);
      }
    };
    playerSocket.addEventListener('message', moveEventListener);

    moveTimeOut = setTimeout(() => {
      playerSocket.removeEventListener('message', moveEventListener);
      const selectedPawn = autoSelectPiece(playerPieces);
      const { pieces, updatedOthers, kill } = changePiecePosition(playerPieces, selectedPawn, dice, otherPlayers);
      if (pieces !== null) {
        const updatedPlayer = { ...currentPlayer, pieces: pieces };
        const mergedPlayers = [updatedPlayer, ...updatedOthers];
        room.players = mergedPlayers;
        if (dice !== 6 || kill) {
          room.turn = nextTurn;
        }
        runningGames.set(roomId, room);
        playGame(roomId);
      }
    }, movePieceAwaitingTime);

  } else {
    // if (dice === 6) { // If the dice is 6 but no move can be made, allow another chance
    //   playGame(roomId);
    // } else {
    room.turn = nextTurn;
    runningGames.set(roomId, room);
    setTimeout(() => {
      playGame(roomId);
    }, 2500);
    // }
  }
}



function handleBotTurn(roomId, room, nextTurn) {
  setTimeout(() => {
    const dice = rollDice();
    room.dice = dice;
    runningGames.set(roomId, room);
    const message = { event: "dice", message: dice };
    emitToRoomPlayers(roomId, message);
    room.turn = nextTurn;
    runningGames.set(roomId, room);
  }, 2000);
  setTimeout(() => {
    playGame(roomId);
  }, 4000);
}


function canPlay(pieces, number) {
  // Check if any piece state is unlocked
  const unlockedPiece = pieces.find(piece => piece.state !== 'locked');

  // If the number is 6 or there is an unlocked piece, return 'can play'
  if (number === 6 || unlockedPiece) {
    return true;
  } else {
    return false;
  }
}


function changePiecePosition(pieces, pieceName, number, otherPlayers) {
  let kill = false
  let updatedOthers = otherPlayers
  let newPosition
  // Find the piece with the given name
  const pieceIndex = pieces.findIndex(piece => piece.name === pieceName);
  const color = pieceName.substring(0, pieceName.length - 1).toLowerCase();


  // If the piece is found
  if (pieceIndex !== -1) {
    const piece = pieces[pieceIndex];
    if (number === 6 && piece.state === 'locked') {
      // If number is 6 and piece is locked, change state to unlocked and position to 0
      piece.state = 'unlocked';
      piece.position = 0;
      newPosition = 0
    } else if (piece.state === 'unlocked') {
      // If piece is unlocked, increment position
      piece.position += number;
      newPosition = piece.position
      const newPosIndex = piece.position
      let positionName
      const path = getPathByColor(color);
      positionName = path[newPosIndex];
      updatedOthers.forEach((player) => {
        const color = player.color
        const otherPlayerPath = getPathByColor(color);
        player.pieces.forEach((piece) => {

          if (piece.state === 'unlocked') {
            const piecePosition = piece.position
            const piecePositionName = otherPlayerPath[piecePosition]
            if (piecePositionName === positionName) {
              piece.state = 'locked'
              piece.position = null
              kill = true
            }

          }

        })
      })





    }
    return { pieces, updatedOthers, kill, newPosition };
  } else {
    // If the piece is not found, return null or throw an error as per your requirement
    return null;
  }
}
function canMovePiece(pieces, pieceName, number) {
  // Find the piece with the given name
  const piece = pieces.find(piece => piece.name === pieceName);

  // If the piece is found
  if (piece) {
    // Check if the piece is unlocked or if the number is 6
    if (piece.state === 'unlocked' || number === 6) {
      // Calculate the potential new position after the move
      const newPosition = piece.position !== null ? piece.position + number : number;

      // Check if the new position is within the board limit
      if (newPosition <= 56) {
        return true; // Piece can play
      }
    }
  }

  // If the piece is not found, locked, or exceeds the board limit, return false
  return false;
}

function autoSelectPiece(playerPieces) {
  // Check if any piece state is unlocked
  const unlockedPiece = playerPieces.find(piece => piece.state !== 'locked');

  // If an unlocked piece is found, return the name of the piece with the highest position
  if (unlockedPiece) {
    let highestPositionPiece = { position: -1 }; // Initialize with a lowest position
    playerPieces.forEach(piece => {
      if (piece.position > highestPositionPiece.position) {
        highestPositionPiece = piece;
      }
    });
    return highestPositionPiece.name;
  }

  // If all pieces are locked, return the name of the first piece
  return playerPieces[0].name;
}


function getPathByColor(color) {
  switch (color) {
    case 'blue':
      return bluePath;
    case 'red':
      return redPath;
    case 'green':
      return greenPath;
    case 'yellow':
      return yellowPath;
    default:
      return null;
  }
}







function rollDice() {
  return Math.floor(Math.random() * 6) + 1;
}

function rollDiceForPlayer() {
  return Math.floor(Math.random() * 6) + 1;
}

// Start the server
const PORT = process.env.PORT || 9000;



server.listen(PORT, () => {
  MongoDbConnection();
  console.log("Server started on Port", process.env.PORT);
});
