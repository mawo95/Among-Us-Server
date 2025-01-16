fastify.register(async function (fastify) {
    fastify.get('/game/:gamePin', { websocket: true }, (connection, req) => {
        gameOver = false
        
        if(games[req.params.gamePin] && games[req.params.gamePin].started == true){
            connection.close()
        }

        let interval;
        try {
            let startTime = undefined;
            interval = setInterval(function() {
                startTime = Date.now();
                connection.send(JSON.stringify({ type: "ping" }));
            }, 2000);


            const playerId = uuidv4();
            const playerColor = getUniqueColor();
            if (!playerColor) {
                connection.close();
                console.error('No available colors');
                return;
            }
            connection.id = playerId;
            connection.color = playerColor;

            const playerData = {
                id: playerId,
                color: playerColor,
                connection: connection,
                role:"innocent",
                tasksFinished:false,
                isKilled:false,
                position: { x: 0, y: 0, z: 0, rotation: 0 }
            };
            players.push(playerData);







            function handlePing() {
                if (startTime !== undefined) {
                    const now = Date.now();
                    connection.send(JSON.stringify({
                        type: "updatePing",
                        ping: Math.round((now - startTime) / 2)
                    }));
                    startTime = undefined;
                }
            }

            function handleKill() {
                const impostorPlayer = players.find(player => player.id === playerId);
            
                if (!impostorPlayer || impostorPlayer.role !== "impostor") return;
            
                const currentTime = Date.now();
                if (currentTime - lastKillTime < KILL_COOLDOWN_MS || inVoting == true) {
                    connection.send(JSON.stringify({
                        type: 'killFailed',
                        reason: inVoting ? "Cannot kill during voting!" : `Kill on cooldown. Wait ${Math.ceil((KILL_COOLDOWN_MS - (currentTime - lastKillTime)) / 1000)} seconds.`
                    }));
                    return;
                }
            
                let targetPlayer = findKillTarget(impostorPlayer);
                if (targetPlayer) {
                    lastKillTime = currentTime;
                    targetPlayer.isKilled = true;
                    killedPersons++;
            
                    broadcastUpdate(impostorPlayer);
                    connection.send(JSON.stringify({ type: 'killSuccess', targetId: targetPlayer.id }));
                    targetPlayer.connection.send(JSON.stringify({ type: 'killed' }));
            
                    if (killedPersons >= killsToWin) {
                        setTimeout(function(){
                        endGame("impostor");
                        },2000)
                    }
                } else {
                    connection.send(JSON.stringify({ type: 'killFailed', reason: 'No target nearby' }));
                }
            }
            
            function findKillTarget(impostorPlayer) {
                return players
                    .filter(player => player.id !== impostorPlayer.id && player.role === "innocent" && !player.isKilled)
                    .reduce((closest, player) => {
                        const distance = calculateDistance(impostorPlayer.position, player.position);
                        return (distance <= DISTANCE_THRESHOLD && (!closest || distance < closest.distance)) 
                            ? { player, distance } 
                            : closest;
                    }, null)?.player;
            }

            function handleTaskCompleted() {
                const player = players.find(p => p.id === playerId && p.role === "innocent" && !p.isKilled && !p.tasksFinished);
                if (player) {
                    player.tasksFinished = true;
                    tasksCompleted++;
                    player.connection.send(JSON.stringify({ type: "taskCompleted" }));
            
                    if (tasksCompleted >= players.length - 1) {
                        setTimeout(function(){
                        endGame("innocent");
                        },1500)
                    }
                }
            }

            function handleMeeting() {
                const player = players.find(p => p.id === playerId);
            
                if (inVoting == true || !player || player.isKilled) {
                    connection.send(JSON.stringify({ type: "meetingError", reason: player.isKilled ? "You are dead!" : "Voting already in progress." }));
                    return;
                }
            
                const currentTime = Date.now();
                if (currentTime - lastMeetingTime < meetingCooldown) {
                    connection.send(JSON.stringify({
                        type: "meetingError",
                        reason: `Meeting on cooldown. Wait ${Math.ceil((meetingCooldown - (currentTime - lastMeetingTime)) / 1000)} seconds.`
                    }));
                    return;
                }
                
                votingEnded = false
            
                broadcastToAll({ type: "meeting" });
                inVoting = true;
                lastMeetingTime = currentTime;
                votingTimer = setTimeout(function(){
                    endVoting(req.params.gamePin)
                }, votingDuration);
            }

            function handleMeetingVote({ color }) {
                if (votingEnded) return;
            
                const player = players.find(p => p.id === playerId);

                if(player.isKilled == true){
                    return
                }
                
            
                if (!votes[color]) votes[color] = 0;
                votes[color]++;
                votedPlayers.add(connection.color);
            
                const alivePlayers = players.filter(p => p.isKilled == false).length;
                if (votedPlayers.size === alivePlayers) {
                    endVoting(req.params.gamePin);
                }
            }

            function handleReady() {
                pressedReady++;
                if (pressedReady >= players.length) {
                    try{
                    gameHostConnection.send(JSON.stringify({ type: "allReady" }));
                    }catch(err){
                        console.log(err)
                        handleStartGame("ye")
                    }
                }
            }

            function handleStartGame(ye=0) {
                if(pressedReady != players.length){}else{
                if (gameHost !== playerId && ye == 0) return;


                games[req.params.gamePin].started = true
            
                pressedReady = 0;
                const impostorIndex = Math.floor(Math.random() * players.length);
                players.forEach((player, index) => {
                    player.role = index === impostorIndex ? "impostor" : "innocent";
                    if (player.role === "innocent") killsToWin++;
                    player.connection.send(JSON.stringify({ type: "start", role: player.role }));
                });
                    
                    gameStarted = true
            
                lastKillTime = Date.now();
                lastMeetingTime = Date.now();
                }
            }

            function handlePositionUpdate({ x, y, z, rotationY }) {
                const player = players.find(p => p.id === playerId && !p.isKilled);
                if (player) {
                    player.position = { x, y, z, rotation: rotationY };
                    broadcastUpdate(player);
                }
            }
            
            function broadcastUpdate(player = 0) {
    const playerData = players.map(p => ({
        id: p.id,
        position: p.position,
        color: p.color,
        isKilled: p.isKilled
    }));


    if (player !== 0) {
        players.forEach(playerLoop => {
            if (playerLoop !== player) { // Nachricht nicht an den angegebenen Spieler schicken

                const filteredData = playerData.filter(p => p.id !== playerLoop.id);
                playerLoop.connection.send(JSON.stringify({ type: "update", players: filteredData }));
            }
        });
    } else {

        players.forEach(playerLoop => {
            const filteredData = playerData.filter(p => p.id !== playerLoop.id);
            playerLoop.connection.send(JSON.stringify({ type: "update", players: filteredData }));
        });
    }
}



            function endGame(winningRole) {
                players.forEach(player => {
                    player.connection.send(JSON.stringify({ type: "win", role: winningRole }));
                });
                
                gameStarted = false

                games[req.params.gamePin].started = false
                gameOver = true
                inVoting = false
                players: [],
                    killedPersons = 0
                    killsToWin = 0
                    pressedReady = 0
                    tasksCompleted = 0
                    inVoting = false
                    votingEnded = false
                    votes = {}
                    votedPlayers = new Set()
                    usedColors = new Set()
                    gameHost = 0
                    gameHostConnection= null
                
            
                return 
            }

            function broadcastToAll(message) {
                players.forEach(player => {
                    player.connection.send(JSON.stringify(message));
                });
            }

            
            
            
            
            
            
            
            
            
            
            



















            setTimeout(function(){
                connection.send(JSON.stringify({
                    type: 'info',
                    color: playerColor,
                    id: playerId
                }));
            
                if (players.length === 1) {
                    gameHostConnection = connection;
                    gameHost = playerId;
            
                    connection.send(JSON.stringify({
                        type: 'welcome',
                        host: true
                    }));
                } else {
                    connection.send(JSON.stringify({
                        type: 'welcome',
                    }));
                }
            },2000)
        
            



            connection.on('message', (message) => {
                if(gameOver == true){}else{
                try {
                    const parsedMessage = message.toString() === "ping" ? { type: "ping" } : JSON.parse(message);

                    switch (parsedMessage.type) {
                        case "ping":
                            handlePing();
                            break;

                         case "kill":
                            handleKill();
                            break;

                        case "taskCompleted":
                            handleTaskCompleted();
                            break;

                        case "meeting":
                            handleMeeting();
                            break;

                        case "meetingVote":
                            handleMeetingVote(parsedMessage);
                                break;

                        case "ready":
                            handleReady();
                            break;

                        case "startGame":
                            handleStartGame();
                            break;

                        case "updatePosition":
                            handlePositionUpdate(parsedMessage);
                            break;

                        default:
                            console.warn("Unknown message type received:", parsedMessage.type);
                    }
                } catch (err) {
                    console.error('Error processing message:', err);
                }
                }
            });





            connection.on("close", () => {
                clearInterval(interval);
                const disconnectedPlayer = players.find(player => player.id === playerId);
                
                if(gameStarted == true){
                    if (disconnectedPlayer) {
                    if (!disconnectedPlayer.isKilled) {
                        if (disconnectedPlayer.role === "innocent") {
                            killedPersons++;
                        }
                    }
                    
                    players = players.filter(player => player.id !== playerId);
                    usedColors.delete(playerColor);
            

                    if (players.filter(p => p.isKilled == false && p.role == "innocent").length === 0) {
                        endGame("impostor");
                    }
                    if (players.filter(p => p.isKilled == false && p.role === "impostor").length === 0) {
                        endGame("innocent");
                    }
                }
                    
                    if (inVoting == true && votingEnded == false) {
                    votedPlayers.delete(disconnectedPlayer.color);
                    const alivePlayers = players.filter(p => p.isKilled == false).length;
                    if (votedPlayers.size === alivePlayers) {
                        endVoting();
                    }
                }
            
                players.forEach(player => {
                    player.connection.send(JSON.stringify({
                        type: 'update',
                        players: players.map(p => ({ id: p.id, position: p.position, color: p.color }))
                    }));
                });
                    
                    
                }else{
                    players = players.filter(player => player.id !== playerId);
                    usedColors.delete(playerColor);
                    players.forEach(player => {
                    player.connection.send(JSON.stringify({
                        type: 'update',
                        players: players.map(p => ({ id: p.id, position: p.position, color: p.color }))
                    }));
                });
                }
            
                

                
            });
                
                
                
                
                
                function endVoting(gamePin) {
    console.log("ending vote");

    if (votingEnded == true){
        return
    }else{
                    console.log("vote ended")
    votingEnded = true;
    clearTimeout(votingTimer);

    let maxVotes = 0;
    let winnerColor = "0";  // "0" für keinen eindeutigen Gewinner
    let playerIdLol = undefined;


    for (const color in votes) {
        if (votes[color] > maxVotes) {
            maxVotes = votes[color];
            winnerColor = color;
        } else if (votes[color] === maxVotes) {
            winnerColor = "0"; 
        }
    }


    if (winnerColor !== "0") {
        players.forEach(player => {
            if (player.color === "#" + winnerColor) {
                player.isKilled = true;
                playerIdLol = player.id;
            }
        });
    }

    let impVoted = false;
    players.forEach(player => {
        if (player.role === "impostor" && player.id === playerIdLol) {
            impVoted = true; // Impostor wurde getötet
        }
    });

    if (impVoted == false && winnerColor != "0") {
        killsToWin--;
        
        const outVotedPlayer = players.find(p => p.id === playerIdLol);
        outVotedPlayer.connection.send(JSON.stringify({type:"outVoted"}))
    }

    const voteResults = {
        type: "meetingResult",
        color: winnerColor,
        id: playerIdLol,
        innocentsWin: impVoted
    };

    players.forEach((player) => {
        player.connection.send(JSON.stringify(voteResults));
    });

    players.forEach(player => {
        if (player.isKilled) {
            player.position = { x: 999, y: 999, z: 999 };  // Verstecke getötete Spieler
            broadcastUpdate(player)
        }
    });
                    
                    


    if (impVoted) {              
        votes = {};
        votedPlayers.clear();
        votingEnded = false;
        endGame("innocent")
        return
    }

    votes = {};
    inVoting = false;
    lastMeetingTime = Date.now();
    lastKillTime = Date.now();
    votedPlayers.clear();
        
}
                }
                
            
            
            




        } catch (err) {
            console.error(err);
        }
    });
});
