'use strict';

// All Node-enabled windows use contextIsolation:false. Run in that same world
// before page scripts or external dependencies can cache DNS/TLS functions.
require('./node-network.cjs');
