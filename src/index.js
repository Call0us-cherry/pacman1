require('fast-text-encoding');
require('aframe');
require('aframe-extras');
require('aframe-particle-system-component');

import {intersections, maze} from './config.js';
import {Howl} from 'howler';

const tickMs = 250; // How often the game updates (every 250 milliseconds)

// How long each powerup lasts
const x10Duration = Math.ceil(6000 / tickMs);   // 6 seconds
const xrayDuration = Math.ceil(8000 / tickMs);  // 8 seconds
const speedDuration = Math.ceil(5000 / tickMs); // 5 seconds

const xrayWallOpacity = 0.25; // How see-through walls become during X-Ray powerup
const superSpeed = 2.6;       // Player speed during speed boost powerup
const pillDuration = 70;      // How many ticks the power pill effect lasts
const chaseDuration = 80;     // How many ticks ghosts spend chasing the player
const scatterDuration = 90;   // How many ticks ghosts spend roaming randomly
const flashDuration = 20;     // When pill timer is below this, ghosts start flashing

// Maze grid starting coordinates and dimensions
const startX = -6.4;
const startZ = -7.3;
const y = 0.8;      // Height pellets float at
const step = .515;  // Distance between each grid cell in 3D space
const radius = .1;  // Base radius for pellet spheres
const row = 29;     // Number of rows in the maze grid
const col = 26;     // Number of columns in the maze grid

// Tile types used in the maze array
const P = {
  WALL: -1,
  ROAD: 0,
  PELLET: 1,
  POWERPILL: 2 
};

// Colours and speeds
const pColor = '#a6c8de';   // Pellet colour
const gColor = 0x2121DE;    // Ghost colour during pill mode (blue)
const gNormSpeed = 0.65;    // Normal ghost speed
const gSlowSpeed = 0.2;     // Ghost speed during pill mode
const gFastSpeed = 1.5;     // Ghost speed when returning to ghost house after being eaten
const gCollideDist = 0.6;   // How close player needs to be to collide with a ghost
const pelletScore = 10;     // Points for eating a pellet
const pillScore = 50;       // Points for eating a power pill
const ghostScore = 200;     // Points for eating a ghost

// Game state variables
let path = [];          // 2D grid storing 3D positions of every maze tile
let pCnt = 0;           // Remaining pellet count
let totalP = 0;         // Total pellets at game start
let targetPos;          // Ghost chase target (player's position)
let dead = true;        // Whether the player is currently dead
let lifeCnt = 3;        // Remaining lives
let highScore;          // All-time high score (loaded from localStorage)
let score = 0;          // Current score
let pillCnt = 0;        // Ticks remaining on power pill effect
let soundCtrl = true;   // Whether sound is on or off
let scoreMultCnt = 0;   // Ticks remaining on score multiplier powerup
let xrayCnt = 0;        // Ticks remaining on X-Ray powerup
let speedCnt = 0;       // Ticks remaining on speed boost powerup

// ─── SOUNDS ───────────────────────────────────────────────────────────────────
// All loaded using Howler.js from assets/sounds/

const siren = new Howl({
  src: ['assets/sounds/sirensound.mp3'], // Normal background music
  loop: true
});

const ghostEaten = new Howl({
  src: ['assets/sounds/ghost-eaten.mp3'], // Plays when a ghost has been eaten and is returning home
  loop: true
});

const waza = new Howl({
  src: ['assets/sounds/waza.mp3'], // Plays during power pill mode
  loop: true
});

const ready = new Howl({
  src: ['assets/sounds/ready.mp3'],
  onend: () => {
    ready.stop();
    siren.play(); // Switch to siren once the ready jingle finishes
  }
});

const eating = new Howl({src: 'assets/sounds/eating.mp3'});    // Pellet eating sound
const eatPill = new Howl({src: 'assets/sounds/eat-pill.mp3'}); // Power pill eating sound
const eatGhost = new Howl({src: 'assets/sounds/eat-ghost.mp3'}); // Ghost eating sound
const die = new Howl({src: 'assets/sounds/die.mp3'});           // Player death sound

// Game modes
const EASY_MODE = 'easy';
const HARD_MODE = 'hard';
let gameMode = EASY_MODE; // default to easy

// Easy mode settings
const easyGhostSpeed = 0.4;      // slower than normal (0.65)
const easyPillDuration = 120;    // longer pill effect (normally 70)

// Hard mode settings  
const hardGhostSpeed = 0.9;      // faster than normal
const hardPillDuration = 40;     // shorter pill effect

// ─── MAZE COMPONENT ───────────────────────────────────────────────────────────
AFRAME.registerComponent('maze', {

  // Creates the two special powerup spheres (X-Ray and Speed) and places them in the maze
  spawnPowerups: function (sceneEl) {
    const defs = [
      { id: 'xray',  type: 'xray',  x: 4,  z: 6,  color: '#00E5FF' }, // Blue X-Ray powerup
      { id: 'speed', type: 'speed', x: 21, z: 20, color: '#FF3B30' }  // Red speed powerup
    ];

    // Extra powerups in easy mode
  if (window.gameMode === 'easy') {
    defs.push(
      { id: 'xray2',  type: 'xray',  x: 10, z: 15, color: '#00E5FF' },
      { id: 'speed2', type: 'speed', x: 15, z: 5,  color: '#FF3B30' }
    );
  }

    defs.forEach(def => {
      // Convert grid coordinates to 3D world position
      const x = startX + def.x * step;
      const z = startZ + def.z * step;

      // Create the sphere element — variable is called 'p'
      const p = document.createElement('a-sphere');
      p.setAttribute('id', def.id);
      p.setAttribute('position', `${x} ${y} ${z}`);
      p.setAttribute('radius', '0.18');
      p.setAttribute('color', def.color);
      p.setAttribute('data-powerup', def.type); // Tag so player collision can detect it

      // Add a spinning animation to make it noticeable
      const anim = document.createElement('a-animation');
      anim.setAttribute('attribute', 'rotation');
      anim.setAttribute('to', '0 360 0');
      anim.setAttribute('dur', '1200');
      anim.setAttribute('repeat', 'indefinite');
      anim.setAttribute('easing', 'linear');
      p.appendChild(anim);
      sceneEl.appendChild(p);
    });
  },

  // Makes all powerup spheres visible again when the game restarts
  resetPowerups: function () {
    document.querySelectorAll('[data-powerup]').forEach(p => {
      p.setAttribute('visible', true);
    });
  },
  
  // Runs once when the maze 3D model finishes loading
  init: function () {
    this.el.addEventListener('model-loaded', () => {
      this.initSoundControl(); // Set up the speaker button
      this.initScene();        // Build pellets and nav grid
      this.spawnPowerups(this.el.sceneEl); // Place powerup spheres
      this.initStartButton();  // Enable the START button

      // Load high score from browser storage
      let hs = localStorage.getItem('highscore');
      highScore = hs ? parseInt(hs) : 0;
      document.querySelector('#highscore').setAttribute('text', {
        'value': highScore
      });
    });
  },

  // Resets lives back to 3
  initLife: function () {
    lifeCnt = 3;
    // Delay to ensure A-Frame life elements are registered in the DOM before rendering
    setTimeout(() => renderLife(3), 100);
  },

  // Sets up the speaker icon click to toggle all sounds on/off
  initSoundControl: function () {
    let soundEl = document.getElementById('sound');
    soundEl.addEventListener('click', () => {
      soundCtrl = !soundCtrl; // Flip the sound state
      let off = 'fa-volume-off';
      let on = 'fa-volume-up';
      // Swap the icon class
      soundEl.className = soundEl.className.replace(soundCtrl ? off : on, soundCtrl ? on : off);
      // Mute/unmute every sound
      ready.mute(!soundCtrl);
      siren.mute(!soundCtrl);
      ghostEaten.mute(!soundCtrl);
      waza.mute(!soundCtrl);
      eating.mute(!soundCtrl);
      eatGhost.mute(!soundCtrl);
      eatPill.mute(!soundCtrl);
      die.mute(!soundCtrl);
    });
  },

  // Builds the 3D scene: pellets, power pills, and the navigation path grid
  initScene: function () {
    setOpacity(this.el, 1.0); // Start with fully opaque walls

    let sceneEl = this.el.sceneEl;
    let cnt = 0;
    let line = [];
    
    // Hide UI elements when entering VR headset
    sceneEl.addEventListener('enter-vr', () => {
      document.getElementById('sound').style.display = 'none';
      document.getElementById('github').style.display = 'none';
      let button = document.getElementById("start");
      // Auto-start the game if the START button is visible
      if (button.innerHTML.indexOf('START') > -1 && button.style.display !== 'none') {
        button.style.display = 'none';
        this.start();
      }
    });
    // Restore UI elements when exiting VR
    sceneEl.addEventListener('exit-vr', () => {
      document.getElementById('sound').style.display = 'block';
      document.getElementById('github').style.display = 'block';
    });

    // Loop through every tile in the maze array from config.js
    for (let i = 0; i < maze.length; i++) {
      let x = startX + i % col * step;               // Calculate 3D X position
      let z = startZ + Math.floor(i / col) * step;   // Calculate 3D Z position

      if (maze[i] >= P.PELLET) { // If tile is a pellet or power pill
        pCnt++;

        // Create a sphere for the pellet
        let sphere = document.createElement('a-sphere');
        sphere.setAttribute('color', pColor);
        sphere.setAttribute('radius', radius * maze[i]); // Power pills are bigger (maze[i] = 2)
        sphere.setAttribute('position', `${x} ${y} ${z}`);
        sphere.setAttribute('id', `p${i}`);  // Unique ID so we can hide it when eaten
        sphere.setAttribute('pellet', '');
        
        // Add a colour flashing animation to power pills
        if (maze[i] >= P.POWERPILL) {
          let animation = document.createElement('a-animation');
          animation.setAttribute("attribute", "material.color");
          animation.setAttribute("from", pColor);
          animation.setAttribute("to", "white");
          animation.setAttribute("dur","500");
          animation.setAttribute("repeat","indefinite");
          sphere.appendChild(animation);
        }
        sceneEl.appendChild(sphere);
      }
      
      // Store the tile's 3D position in the path grid for navigation
      line.push(maze[i] >= 0 ? [x, y, z, maze[i] > 0 ? i : P.WALL, maze[i]] : []);
      cnt++;
      if (cnt > (col - 1)) { // Once we've filled a full row, push it to path
        path.push(line);
        line = [];
        cnt = 0;
      }
    }
    totalP = pCnt; // Save total pellet count for restarting
  },

  // Enables the START button once the game is ready to play
  initStartButton: function () {
    let button = document.getElementById("start");
    let button2 = document.getElementById("easy-btn");
    let button3 = document.getElementById("hard-btn");
    if (button) {
      button.addEventListener('click', this.start.bind(this));
      button.innerHTML = "START";
      button.disabled = false;
      button2.disabled = false;
      button3.disabled = false;
    }
  },

  // Called when START or RESTART is clicked — resets and begins a new game
  start: function () {
    this.resetPowerups();  // Make powerup spheres visible again
    this.initLife();       // Reset to 3 lives

    // Apply mode settings to ghosts
  const ghostSpeed = window.gameMode === 'easy' ? easyGhostSpeed : hardGhostSpeed;
  document.querySelectorAll('[ghost]').forEach(ghost => {
    ghost.setAttribute('nav-agent', { speed: ghostSpeed });
  });

  window.activePillDuration = window.gameMode === 'easy' ? easyPillDuration : hardPillDuration;


    // Make all pellets visible again
    document.querySelectorAll('[pellet]')
      .forEach(p => p.setAttribute('visible', true));
    pCnt = totalP; // Reset pellet counter

    // Update the UI
    document.getElementById("logo").style.display = 'none';
    document.getElementById("start").style.display = 'none';
    document.getElementById("hard-btn").style.display = 'none';
    document.getElementById("easy-btn").style.display = 'none';
    document.getElementById("gameover").style.display = 'none';
    document.getElementById("ready").style.display = 'block'; // Show "READY!"

    // Reset score display
    score = 0;
    document.querySelector('#score').setAttribute('text', { 'value': score });

    ready.play();        // Play the ready jingle
    window.startTimer(); // Start the timer when player clicks start
    restart(3000);       // Start the game after 3 seconds
  }
});

// ─── PLAYER COMPONENT ─────────────────────────────────────────────────────────
AFRAME.registerComponent('player', {

  // Runs once when the player entity is created
  init: function () {
    this.scoreMultCnt = 0;  // Score multiplier timer
    this.xrayCnt = 0;       // X-Ray powerup timer
    this.speedCnt = 0;      // Speed boost timer
    this.baseSpeed = gNormSpeed;
    this.tick = AFRAME.utils.throttleTick(this.tick, 250, this); // Limit tick to every 250ms
    this.waveCnt = 0;       // Scatter/chase mode timer
    this.hitGhosts = [];    // Tracks which ghosts were eaten during one pill mode
    this.ghosts = document.querySelectorAll('[ghost]'); // All ghost entities
    this.player = document.querySelector('[player]');
    this.currentBg = siren; // Currently playing background sound
    this.nextBg = siren;
  },

  // Runs every 250ms while the game is active
  tick: function () {
    if (!dead && path.length >= row) {
      this.nextBg = siren;

      let position = this.el.getAttribute('position');
      let x = position.x;
      let y = position.y;
      let z = position.z;

      this.updatePlayerDest(x, y, z);      // Move player based on camera direction
      this.onCollideWithPellets(x, z);     // Check if player is on a pellet
      this.updateGhosts(x, z);             // Update ghost states and check collision
      this.updateMode(position);           // Update scatter/chase/pill mode
      this.onCollideWithPowerups(x, z);    // Check if player touched a powerup
      this.updatePowerupEffects();         // Apply active powerup effects

      // Update score display in HUD
      document.querySelector('#score').setAttribute('text', { value: score });

      // Switch background music if needed
      if (this.nextBg && this.currentBg != this.nextBg) {
        this.currentBg.stop();
        this.nextBg.play();
        this.currentBg = this.nextBg;
      } 
    }
  },

  // Returns 10 if score multiplier powerup is active, otherwise 1
  getScoreMultiplier: function () {
    return this.scoreMultCnt > 0 ? 10 : 1;
  },

  // Checks if player walked over a powerup sphere and activates its effect
  onCollideWithPowerups: function (x, z) {
    document.querySelectorAll('[data-powerup]').forEach(p => {
      if (!p.getAttribute('visible')) return; // Skip already collected powerups

      const pos = p.getAttribute('position');
      // Check if player is close enough
      if (Math.abs(pos.x - x) < gCollideDist && Math.abs(pos.z - z) < gCollideDist) {
        p.setAttribute('visible', false); // Hide the collected powerup

        const type = p.getAttribute('data-powerup');
        if (type === 'xray') {
          this.xrayCnt = xrayDuration;   // Start X-Ray timer
        } else if (type === 'speed') {
          this.speedCnt = speedDuration; // Start speed boost timer
        }
      }
    });
  },

  // Counts down powerup timers and applies/removes their effects each tick
  updatePowerupEffects: function () {
    const mazeEl = document.querySelector('[maze]');

    // Count down active timers
    if (this.scoreMultCnt > 0) this.scoreMultCnt--;
    if (this.xrayCnt > 0) this.xrayCnt--;
    if (this.speedCnt > 0) this.speedCnt--;

    // X-Ray: make walls semi-transparent while active
    if (this.xrayCnt > 0) {
      setOpacity(mazeEl, xrayWallOpacity); // 25% opacity
    } else {
      setOpacity(mazeEl, 1.0); // Restore full opacity when expired
    }

    // Speed boost: increase player nav-agent speed while active
    if (this.speedCnt > 0) {
      this.player.setAttribute('nav-agent', { speed: superSpeed });
    } else {
      this.player.setAttribute('nav-agent', { speed: this.baseSpeed });
    }
  },

  // Calculates where the player should move based on the camera's facing direction
  updatePlayerDest: function (x, y, z) {
    let camera = document.querySelector("a-camera");
    let angle = camera.getAttribute("rotation"); // Get which way the player is looking

    // Calculate the next step position in the direction the camera faces
    let _z = step * Math.cos(angle.y * Math.PI / 180);
    let _x = step * Math.sin(angle.y * Math.PI / 180);
    let z_ = Math.round((z - _z - startZ) / step);
    let x_ = Math.round((x - _x - startX) / step);

    // Clamp to maze grid boundaries
    let i = z_ > row - 1 ? row - 1 : z_ < 0 ? 0 : z_;
    let j = x_ > col - 1 ? col - 1 : x_ < 0 ? 0 : x_;

    // Handle the left/right tunnel warp
    if (i === 13 && j === 0)       // Exiting left side — teleport to right side
      this.el.object3D.position.set(path[13][24][0], y, path[13][24][2]);
    else if (i === 13 && j === 25) // Exiting right side — teleport to left side
      this.el.object3D.position.set(path[13][1][0], y, path[13][1][2]);
    else {
      let newPos = path[i][j];
      if (newPos && newPos.length > 0)
        updateAgentDest(this.player, new THREE.Vector3(newPos[0], 0, newPos[2]));
    }
  },

  // Updates all ghosts each tick — checks collisions, handles pill mode flashing
  updateGhosts: function (x, z) {
    let ghosts = this.ghosts;
    for (var i = 0; i < ghosts.length; i++) {
      if (ghosts[i].dead) this.nextBg = ghostEaten; // Switch to ghost-eaten music

      this.onCollideWithGhost(ghosts[i], x, z, i);

      if (ghosts[i].slow) { // Ghost is in pill mode (slowed down, blue)
        if (pillCnt === 1) { // Pill mode is ending — revert ghost to normal
          updateGhostColor(ghosts[i].object3D, ghosts[i].defaultColor);
          ghosts[i].slow = false;
          ghosts[i].setAttribute('nav-agent', { speed: gNormSpeed });
        } else if (pillCnt > 1) {
          // Flash white when pill mode is almost over
          if (pillCnt < flashDuration && pillCnt % 2 === 0)
            updateGhostColor(ghosts[i].object3D, 0xFFFFFF); // White flash
          else
            updateGhostColor(ghosts[i].object3D, gColor);   // Blue
        }
      }
    }
  },

  // Manages ghost AI mode — switches between scatter and chase on a timer
  updateMode: function (position) {
    targetPos = null;
    if (pillCnt > 0) {
      pillCnt--; // Count down pill duration
      if (this.nextBg != ghostEaten) this.nextBg = waza; // Play waza music during pill mode
    } else {
      // Alternate between scatter (random) and chase (follow player)
      this.waveCnt = this.waveCnt > (chaseDuration + scatterDuration) ? 0 : this.waveCnt + 1;
      if (this.waveCnt > scatterDuration)
        targetPos = position; // Set player position as ghost target during chase
    }
  },

  // Shows game over or win screen and stops everything
  onGameOver: function (win) {
    this.nextBg = undefined;
    siren.stop();
    waza.stop();
    ghostEaten.stop();
    
    this.el.sceneEl.exitVR(); // Exit VR mode

    let gameoverEl = document.getElementById("gameover");
    gameoverEl.innerHTML = win ? 'YOU WIN' : 'GAME OVER';
    if (win) 
      gameoverEl.classList.add("blink");    // Blink on win
    else
      gameoverEl.classList.remove("blink"); // No blink on loss
    gameoverEl.style.display = 'block';

    // Show the restart button
    let startEl = document.getElementById("start");
    startEl.innerHTML = 'RESTART';
    startEl.style.display = 'block';

    // Show mode buttons again so player can switch before restarting
    document.getElementById("easy-btn").style.display = 'block';
    document.getElementById("hard-btn").style.display = 'block';
  },

  // Checks if player is touching a specific ghost and handles the outcome
  onCollideWithGhost: function (ghost, x, z, i) {
    let ghostX = ghost.getAttribute('position').x;
    let ghostZ = ghost.getAttribute('position').z;

    if (Math.abs(ghostX - x) < gCollideDist && Math.abs(ghostZ - z) < gCollideDist) {
      if (!ghost.dead) {
        if (ghost.slow) { // Ghost is in pill mode — player eats it
          eatGhost.play();
          this.hitGhosts.push(i); // Track for score multiplier
          ghost.dead = true;
          ghost.slow = false;

          // Send ghost back to ghost house
          ghost.setAttribute('nav-agent', { active: false, speed: gFastSpeed });
          updateAgentDest(ghost, ghost.defaultPos);

          setOpacity(ghost, 0.3); // Make ghost semi-transparent
          score += ghostScore * this.hitGhosts.length; // More points for consecutive ghosts
        } else { // Ghost is normal — player dies
          this.onDie();
          return;
        }
      }
    }
  },

  // Checks if player is standing on a pellet or power pill and collects it
  onCollideWithPellets: function (x, z) {
    // Convert 3D position to grid coordinates
    let i = Math.round((z - startZ) / step);
    let j = Math.round((x - startX) / step);
    let currentP = path[i > row - 1 ? row - 1 : i < 0 ? 0 : i][j > col - 1 ? col - 1 : j < 0 ? 0 : j];

    if (currentP && currentP[4] >= P.PELLET) {
      let pellet = document.querySelector(`#p${currentP[3]}`);
      if (pellet && pellet.getAttribute('visible')) {
        pCnt--; // One less pellet remaining
        pellet.setAttribute('visible', false); // Hide the eaten pellet

        if (currentP[4] >= P.POWERPILL) { // It's a power pill
          eatPill.play();
          this.scoreMultCnt = x10Duration; // Start x10 score multiplier
          score += pillScore * this.getScoreMultiplier();
          this.onEatPill(); // Activate pill mode
        } else { // Regular pellet
          eating.play();
          score += pelletScore * this.getScoreMultiplier();
        }
      }
      if (pCnt < 1) this.onWin(); // All pellets eaten — player wins!
    }
  },

  // Activates power pill mode — slows and turns all ghosts blue
  onEatPill: function () {
  pillCnt = window.activePillDuration || pillDuration; // use mode duration if set
  this.hitGhosts = [];
  this.ghosts.forEach(ghost => {
    updateGhostColor(ghost.object3D, gColor);
    ghost.slow = true;
    ghost.setAttribute('nav-agent', { speed: gSlowSpeed });
  });
},

  // Player has eaten all pellets — trigger win
  onWin: function () {
    this.stop();
    this.onGameOver(true);
  },

  // Player touched a normal ghost — lose a life
  onDie: function () {
    die.play();
    window.stopTimer(); // Stop the timer immediately on death
    this.stop();

    // Play a 720° spin animation on the player
    let player = this.player;
    player.setAttribute('nav-agent', { active: false });
    let animation = document.createElement('a-animation');
    animation.setAttribute("attribute", "rotation");
    animation.setAttribute("to", "0 720 0");
    animation.setAttribute("dur", "2000");
    animation.setAttribute("easing", "linear");
    animation.setAttribute("repeat", "0");
    player.appendChild(animation);

    setTimeout(() => {
      if (lifeCnt > 0) {        // Still has lives left
        player.removeChild(animation);
        restart(1500, true);    // Restart after 1.5 seconds, deduct a life
      } else {
        this.onGameOver(false); // No lives left — game over
      }
    }, 1000);
  },

  // Pauses the game — called on death or win
  stop: function () {
    this.scoreMultCnt = 0; // Reset all powerup timers
    this.xrayCnt = 0;
    this.speedCnt = 0;

    // Restore wall opacity in case X-Ray was active
    const mazeEl = document.querySelector('[maze]');
    if (mazeEl) setOpacity(mazeEl, 1.0);

    disableCamera(); // Stop player looking around
    dead = true;
    pillCnt = 0;
    this.waveCnt = 0;

    // Save high score to browser storage if beaten
    if (score > highScore) {
      highScore = score;
      document.querySelector('#highscore').setAttribute('text', { 'value': highScore });
      localStorage.setItem('highscore', highScore);
    }

    // Freeze all ghosts
    this.ghosts.forEach(ghost => {
      ghost.setAttribute('nav-agent', { active: false, speed: gNormSpeed });
    });

    // Reset all ghosts to their starting positions and appearance
    this.ghosts.forEach(ghost => {
      ghost.dead = false;
      ghost.slow = false;
      updateGhostColor(ghost.object3D, ghost.defaultColor); // Restore original colour
      setOpacity(ghost, 1);                                  // Restore full opacity
      ghost.object3D.position.set(ghost.defaultPos.x, ghost.defaultPos.y, ghost.defaultPos.z);
    });
  }
});

// ─── GHOST COMPONENT ──────────────────────────────────────────────────────────
AFRAME.registerComponent('ghost', {
  schema: {type: 'string'}, // Accepts the ghost's colour as a hex string e.g. "0xFF0000"

  // Runs once when a ghost entity is created
  init: function () {
    let el = this.el;
    let pos = el.getAttribute('position');
    el.defaultPos = new THREE.Vector3(pos.x, pos.y, pos.z); // Save starting position
    el.defaultColor = this.data;                             // Save starting colour
    el.addEventListener('model-loaded', () => updateGhostColor(el.object3D, el.defaultColor));
    el.addEventListener('navigation-end', this.onNavEnd.bind(this)); // When ghost reaches its target
  },

  // Called every time a ghost reaches its destination
  onNavEnd: function () {
    let el = this.el;
    if (el.dead) { // Ghost just returned to ghost house after being eaten
      el.dead = false;
      el.slow = false;
      setOpacity(el, 1);                               // Make fully visible again
      updateGhostColor(el.object3D, el.defaultColor);  // Restore original colour
      el.setAttribute('nav-agent', { speed: gNormSpeed });
    }
    // Pick a random intersection on the map to walk to next
    let p = Math.floor(Math.random() * intersections.length);
    let x = startX + intersections[p][0] * step;
    let z = startZ + intersections[p][1] * step;
    // Chase player if in chase mode, otherwise roam randomly
    updateAgentDest(el, targetPos ? targetPos : new THREE.Vector3(x, 0, z));
  }
}); 

// ─── HELPER FUNCTIONS ─────────────────────────────────────────────────────────

// Sets the opacity of a 3D object's mesh materials
// Used for: X-Ray walls (0.25), eaten ghosts (0.3), restoring full opacity (1.0)
function setOpacity(object, opacity) {
  const mesh = object.getObject3D('mesh');
  if (!mesh) return;
  mesh.traverse(node => {
    if (node.isMesh) {
      node.material.opacity = opacity;
      node.material.transparent = opacity < 1.0;
      node.material.needsUpdate = true;
    }
  });
}

// Tells a nav-agent (player or ghost) to move to a new destination
function updateAgentDest(object, dest) {
  object.setAttribute('nav-agent', {
    active: true,
    destination: dest
  });
}

// Changes a ghost's body colour by finding its material named 'ghostmat'
function updateGhostColor(ghost, color) {
  ghost.traverse(child => {
    if (child instanceof THREE.Mesh && child.material.name === 'ghostmat')
      child.material.color.setHex(color);
  });
}

// Teleports the player back to their starting position (0, 0, 4)
function movePlayerToDefaultPosition() {
  const player = document.querySelector('[player]');
  player.object3D.position.set(0, 0, 4);
  player.object3D.rotation.set(0, 0, 0);
}

// Disables look-controls so player can't move the camera (used during death/game over)
function disableCamera() {
  const camera = document.querySelector("a-camera");
  camera.removeAttribute('look-controls');
  camera.setAttribute('look-controls', { 'enabled': false });
}

// Re-enables look-controls with pointer lock when gameplay resumes
function enableCamera() {
  const camera = document.querySelector("a-camera");
  camera.removeAttribute('look-controls');
  camera.setAttribute('look-controls', { 'pointerLockEnabled': true });
}

// Decrements the life counter by 1 and updates the HUD
function updateLife() {  
  if (lifeCnt > 0) {
    lifeCnt--;
    renderLife(lifeCnt);
  }
}

// Shows/hides the Pac-Man life icons in the HUD based on remaining lives
// e.g. renderLife(2) shows 2 icons, hides the 3rd
function renderLife(cnt ) {
  let lifeEls = document.querySelectorAll("[life]");
  // FIX: use forEach with index so each icon is shown/hidden based on position
  lifeEls.forEach((el, i) => {
    el.setAttribute('visible', i < (cnt+1) ? 'true' : 'false');
  });
}

// Resets the player position then starts the game after a delay
// timeout = how long to wait before unpausing (e.g. 3000ms at game start, 1500ms after death)
// lostLife = whether to deduct a life (false on first start, true after death)
function restart(timeout, lostLife = false) {
  movePlayerToDefaultPosition();
  setTimeout(() => {
    document.getElementById("ready").style.display = 'none'; // Hide "READY!"
    document.querySelectorAll('[ghost]')
      .forEach(ghost => updateAgentDest(ghost, ghost.defaultPos)); // Send ghosts to start
    dead = false;
    if (lostLife) updateLife(); // Only deduct a life if player actually died
    enableCamera();             // Let player look around again
  }, timeout);    
}
