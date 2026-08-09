import { styleText } from 'util';
import detectPort from 'detect-port';
import { PORT } from '../../config/env';

(function CheckPortInUse() {
  const _port = PORT.toString();

  detectPort(_port, (err, availablePort) => {
    if (_port !== String(availablePort)) {
      throw new Error(
        styleText(
          ['whiteBright', 'bgRed', 'bold'],
          // oxlint-disable-next-line prefer-template
          'Port "' +
            _port +
            '" on "localhost" is already in use. Please use another port.',
        ),
      );
    } else {
      process.exit(0);
    }
  });
})();
