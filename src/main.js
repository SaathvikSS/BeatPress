import { Game } from "./Game.js";

const canvas = document.getElementById("gameCanvas");
const game = new Game(canvas);
game.start();

window.__beatStarDebug = {
  getState: () => game.getDebugState(),
};
