const mqtt = require('mqtt')
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


const client = mqtt.connect(options);

const topic = process.env.IOT_MQ_TOPIC || "nodejs/test"

client.on('connect', (error) => {

  if (error) {
    console.error(error)
  }

  console.log('Connected')

  client.subscribe([topic], (error) => {

    if (error) {
      console.error(error)
    }

    console.log(`Subscribe to topic '${topic}'`)
    
    /*
    client.publish(topic, 'nodejs mqtt test', { qos: 0, retain: false }, (error) => {
      if (error) {
        console.error(error)
      }
    })
    */
  })
})


client.on('message', (topic, message) => {
  console.log(`Received message on topic ${topic}: ${message}`)
})

