// React Router v7 expects Web text encoders; CRA's jsdom test runtime omits them.
const { TextDecoder, TextEncoder } = require('util');

global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;
