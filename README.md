# smart-home-relay
A server that relays relevant smart home HTTP requests to handling servers

## Usage

### Generating .env
smart-home-relay uses dotenv to store environment variables. Running the following script will generate the .env file containing default values. Please modify these to suit your environment.

    node setup.js

### Running the server
Run the smart-home-server using the following command.

    node index.js
