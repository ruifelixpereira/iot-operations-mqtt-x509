const mqtt = require("async-mqtt")
const fs = require('fs');

const clientId = `mqtt_iot_client_${Math.random().toString(16).slice(3)}`

// Usng certificates
const options = {
    protocol: 'mqtts',
    protocolVersion: 5,
    host: '172.30.226.19',
    port: 8883,
    ca: [fs.readFileSync('../chain_server_client.pem')],
    cert: fs.readFileSync('../foo.crt'),
    key: fs.readFileSync('../foo.key'),
};

const topic = process.env.IOT_MQ_TOPIC || "nodejs/test"

async function run() {

    try {

        const client = await mqtt.connectAsync(options);

        await client.publish(topic, 'nodejs mqtt test async', { qos: 0, retain: false });

        await client.end();
        console.log("Message published");

    } catch (error) {

    		// Do something about it!
		    console.log(e.stack);
		    process.exit();
    }
}

run();