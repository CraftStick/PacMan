# Pac-Man Mini Game

[English](README.md) · [Русский](README.ru.md)

A lightweight browser mini-game in the style of Pac-Man, handy for keeping a user busy while a task is processing.

## Features

- Smooth movement of Pac-Man and the ghosts
- Keyboard controls (arrows and WASD)
- Score, lives, win and lose states
- Instant restart without reloading the page
- No dependencies: plain HTML, CSS and JavaScript

## Controls

- `ArrowUp` / `W` — up
- `ArrowDown` / `S` — down
- `ArrowLeft` / `A` — left
- `ArrowRight` / `D` — right
- `R` — new game

## Getting Started

Open `index.html` in a browser, or serve the folder with a local server (recommended):

```bash
python3 -m http.server 8080
```

Then open <http://localhost:8080>.

## Project Structure

- `index.html` — game markup and HUD
- `styles.css` — interface and board styles
- `game.js` — game logic, ghost AI, rendering and the game loop
