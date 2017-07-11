const throttle = require('lodash.throttle');
const Color = require('color');
const nameToHex = require('convert-css-color-name-to-hex');
const toHex = (str) => Color(nameToHex(str)).hexString();
const values = require('lodash.values');

// Keywords (TODO: pass in through configuration)
const PARTICLE_ON_KEYWORD = 'power-up';
const SHAKE_ON_KEYWORD = 'power-rage';
const ALL_OFF_KEYWORD = 'power-down';

// Constants for the particle simulation.
const MAX_PARTICLES = 500;
const PARTICLE_NUM_RANGE = () => 5 + Math.round(Math.random() * 5);
const PARTICLE_GRAVITY = 0.075;
const PARTICLE_ALPHA_FADEOUT = 0.96;
const PARTICLE_VELOCITY_RANGE = {
  x: [-1, 1],
  y: [-3.5, -1.5]
};

// Our extension's custom redux middleware. Here we can intercept redux actions and respond to them.
exports.middleware = (store) => (next) => (action) => {
  // the redux `action` object contains a loose `type` string, the
  // 'SESSION_ADD_DATA' type identifier corresponds to an action in which
  // the terminal wants to output information to the GUI.
  if ('SESSION_ADD_DATA' === action.type) {

    // 'SESSION_ADD_DATA' actions hold the output text data in the `data` key.
    const { data } = action;
    // Here, we are responding to special commands being input at the prompt. Since we don't
    // want the "unknown command" output being displayed to the user, we don't thunk the next
    // middleware by calling `next(action)`. Instead, we dispatch a new action.
    if (detectCommand(PARTICLE_ON_KEYWORD, data)) {
      store.dispatch({ type: 'PARTICLE_MODE_ON' });
    }
    else if (detectCommand(SHAKE_ON_KEYWORD, data)) {
      store.dispatch({ type: 'SHAKE_MODE_ON' });
    }
    else if (detectCommand(ALL_OFF_KEYWORD, data)) {
      store.dispatch({ type: 'ALL_MODES_OFF' });
    }
    else {
      next(action);
    }
  } else {
    next(action);
  }
};

// This function performs regex matching on expected shell output for <keyword> being input
// at the command line. Currently it supports output from bash, zsh, fish, cmd and powershell.
function detectCommand(keyword, data) {
  const patterns = [
    keyword + ': command not found',
    'command not found: ' + keyword,
    'Unknown command \'' + keyword + '\'',
    '\'' + keyword + '\' is not recognized.*'
  ];
  return new RegExp('(' + patterns.join(')|(') + ')').test(data)
}

// Our extension's custom ui state reducer. Here we can listen for our custom actions
// and modify the state accordingly.
exports.reduceUI = (state, action) => {
  switch (action.type) {
    case 'PARTICLE_MODE_ON':
      return state.set('particleMode', true)
                  .set('shakeMode', false)
                  .set('allColorsMode', false);
    case 'SHAKE_MODE_ON':
      return state.set('particleMode', true)
                  .set('shakeMode', true)
                  .set('allColorsMode', true);
    case 'ALL_MODES_OFF':
      return state.set('particleMode', false)
                  .set('shakeMode', false)
                  .set('allColorsMode', false);
  }
  return state;
};

// Our extension's state property mapper. Here we can pass the ui's states
// into the terminal component's properties.
exports.mapTermsState = (state, map) => {
  return Object.assign(map, {
    particleMode: state.ui.particleMode,
    shakeMode: state.ui.shakeMode,
    allColorsMode: state.ui.allColorsMode
  });
};

// We'll need to handle reflecting the properties down through possible nested
// parent/children terminal hierarchies.
const passProps = (uid, parentProps, props) => {
  return Object.assign(props, {
    particleMode: parentProps.particleMode,
    shakeMode: parentProps.shakeMode,
    allColorsMode: parentProps.allColorsMode
  });
}

exports.getTermGroupProps = passProps;
exports.getTermProps = passProps;

// The `decorateTerm` hook allows our extension to return a higher order react component.
// It supplies us with:
// - Term: The terminal component.
// - React: The enture React namespace.
// - notify: Helper function for displaying notifications in the operating system.
//
// The portions of this code dealing with the particle simulation are heavily based on:
// - https://atom.io/packages/power-mode
// - https://github.com/itszero/rage-power/blob/master/index.jsx
exports.decorateTerm = (Term, { React, notify }) => {
  // Define and return our higher order component.
  return class extends React.Component {
    constructor (props, context) {
      super(props, context);
      // Since we'll be passing these functions around, we need to bind this
      // to each.
      this._drawFrame = this._drawFrame.bind(this);
      this._resizeCanvas = this._resizeCanvas.bind(this);
      this._onTerminal = this._onTerminal.bind(this);
      this._onCursorChange = this._onCursorChange.bind(this);
      this._shake = throttle(this._shake.bind(this), 100, { trailing: false });
      this._spawnParticles = throttle(this._spawnParticles.bind(this), 25, { trailing: false });
      // Initial particle state
      this._particles = [];
      // We'll set these up when the terminal is available in `_onTerminal`
      this._div = null;
      this._cursor = null;
      this._observer = null;
      this._canvas = null;
    }

    _onTerminal (term) {
      if (this.props.onTerminal) this.props.onTerminal(term);
      this._div = term.div_;
      this._cursor = term.cursorNode_;
      this._window = term.document_.defaultView;
      // We'll need to observe cursor change events.
      this._observer = new MutationObserver(this._onCursorChange);
      this._observer.observe(this._cursor, {
        attributes: true,
        childList: false,
        characterData: false
      });
      this._initCanvas();
    }

    // Set up our canvas element we'll use to do particle effects on.
    _initCanvas () {
      this._canvas = document.createElement('canvas');
      this._canvas.style.position = 'absolute';
      this._canvas.style.top = '0';
      this._canvas.style.pointerEvents = 'none';
      this._canvasContext = this._canvas.getContext('2d');
      this._canvas.width = window.innerWidth;
      this._canvas.height = window.innerHeight;
      document.body.appendChild(this._canvas);
      this._window.requestAnimationFrame(this._drawFrame);
      this._window.addEventListener('resize', this._resizeCanvas);
    }

    _resizeCanvas () {
      this._canvas.width = window.innerWidth;
      this._canvas.height = window.innerHeight;
    }

    // Draw the next frame in the particle simulation.
    _drawFrame () {
      this._canvasContext.clearRect(0, 0, this._canvas.width, this._canvas.height);
      this._particles.forEach((particle) => {
        particle.velocity.y += PARTICLE_GRAVITY;
        particle.x += particle.velocity.x;
        particle.y += particle.velocity.y;
        particle.alpha *= PARTICLE_ALPHA_FADEOUT;
        this._canvasContext.fillStyle = `rgba(${particle.color.join(',')}, ${particle.alpha})`;
        this._canvasContext.fillRect(Math.round(particle.x - 1), Math.round(particle.y - 1), 3, 3);
      });
      this._particles = this._particles
        .slice(Math.max(this._particles.length - MAX_PARTICLES, 0))
        .filter((particle) => particle.alpha > 0.1);
      this._window.requestAnimationFrame(this._drawFrame);
    }

    // Pushes `PARTICLE_NUM_RANGE` new particles into the simulation.
    _spawnParticles (x, y) {
      // const { colors } = this.props;
      const colors = this.props.allColorsMode
        ? values(this.props.colors).map(toHex)
        : [toHex(this.props.cursorColor)];
      const numParticles = PARTICLE_NUM_RANGE();
      for (let i = 0; i < numParticles; i++) {
        const colorCode = colors[i % colors.length];
        const r = parseInt(colorCode.slice(1, 3), 16);
        const g = parseInt(colorCode.slice(3, 5), 16);
        const b = parseInt(colorCode.slice(5, 7), 16);
        const color = [r, g, b];
        this._particles.push(this._createParticle(x, y, color));
      }
    }

    // Returns a particle of a specified color
    // at some random offset from the input coordinates.
    _createParticle (x, y, color) {
      return {
        x,
        y: y,
        alpha: 1,
        color,
        velocity: {
          x: PARTICLE_VELOCITY_RANGE.x[0] + Math.random() *
            (PARTICLE_VELOCITY_RANGE.x[1] - PARTICLE_VELOCITY_RANGE.x[0]),
          y: PARTICLE_VELOCITY_RANGE.y[0] + Math.random() *
            (PARTICLE_VELOCITY_RANGE.y[1] - PARTICLE_VELOCITY_RANGE.y[0])
        }
      };
    }

    // 'Shakes' the screen by applying a temporary translation
    // to the terminal container.
    _shake () {
      const intensity = 1 + 2 * Math.random();
      const x = intensity * (Math.random() > 0.5 ? -1 : 1);
      const y = intensity * (Math.random() > 0.5 ? -1 : 1);
      this._div.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      setTimeout(() => {
        if (this._div) this._div.style.transform = '';
      }, 75);
    }

    _onCursorChange () {
      if (this.props.shakeMode) {
        this._shake();
      }
      if (this.props.particleMode) {
        // Get current coordinates of the cursor relative the container and
        // spawn new articles.
        const { top, left } = this._cursor.getBoundingClientRect();
        const origin = this._div.getBoundingClientRect();
        requestAnimationFrame(() => {
          this._spawnParticles(left + origin.left, top + origin.top);
        });
      }
    }

    // Called when the props change, here we'll check if modes have gone
    // on -> off or off -> on and notify the user accordingly.
    componentWillReceiveProps (next) {
      if (next.particleMode && !this.props.particleMode) {
        notify('Powering up');
      } else if (next.shakeMode && !this.props.shakeMode) {
        notify('RAGE MODE!');
    } else if (!next.particleMode && this.props.particleMode) {
        notify('Powering down');
      }
    }

    render () {
      // Return the default Term component with our custom onTerminal closure
      // setting up and managing the particle effects.
      return React.createElement(Term, Object.assign({}, this.props, {
        onTerminal: this._onTerminal
      }));
    }

    componentWillUnmount () {
      document.body.removeChild(this._canvas);
      // Stop observing _onCursorChange
      if (this._observer) {
        this._observer.disconnect();
      }
    }
  }
};
