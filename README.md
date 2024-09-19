# MQTT with X-509 auth test

References:
- https://learn.microsoft.com/en-us/azure/iot-operations/manage-mqtt-connectivity/overview-iot-mq


## Concepts

### Broker

```bash
kubectl get broker broker -n azure-iot-operations -o yaml
```

## Listener

A listener corresponds to a network endpoint that exposes the broker to the network. Each listener can have its own authentication and authorization rules that define who can connect to the listener and what actions they can perform on the broker. You can use BrokerAuthentication and BrokerAuthorization resources to specify the access control policies for each listener. 

```bash
kubectl get svc -n azure-iot-operations
```

![alt text](docs/assets/image.png) 

```bash
kubectl get brokerlistener listener -n azure-iot-operations -o yaml
```

### Server certificate

With automatic certificate management, you use cert-manager to manage the TLS server certificate. By default, cert-manager is installed alongside Azure IoT Operations Preview in the azure-iot-operations namespace already. 

### Broker Authentication

BrokerListener and BrokerAuthentication are separate resources, but they're linked together using listenerRef. The following rules apply:

- A BrokerListener can be linked to only one BrokerAuthentication
- A BrokerAuthentication can be linked to multiple BrokerListeners
- Each BrokerAuthentication can support multiple authentication methods at once

## End to end test

### Step 1. Install Step CLI

Step CLI is a command line to quickly create self-signed or CA base certificates. This is used to manage the CA and issue certificates. You can install the tool from [Step CLI](https://smallstep.com/docs/step-cli/installation/).

```bash
wget https://dl.smallstep.com/cli/docs-cli-install/latest/step-cli_amd64.deb
sudo dpkg -i step-cli_amd64.deb
```

### Step 2. Setup an offline CA

To create the root and intermediate CA certificates run:

```bash
mkdir ca

export STEPPATH="$PWD/ca"

step ca init \
    --deployment-type standalone \
    --name MqttAppSamplesCA \
    --dns localhost \
    --address 127.0.0.1:443 \
    --provisioner MqttAppSamplesCAProvisioner
```

Follow the cli instructions, when done make sure you remember the password used to protect the private keys, by default the generated certificates and keys are stored in:

```bash
ca/certs/root_ca.crt
ca/certs/intermediate_ca.crt
ca/secrets/root_ca_key
ca/secrets/intermediate_ca_key
```

The CA certs are valid for 10 years.

### Step 3. Create Chain

```bash
# Not needed: cat ca/certs/root_ca.crt ca/certs/intermediate_ca.crt > chain.pem
cat ca/certs/root_ca.crt > client_ca.pem
```

### Step 4. Generate client certificate for an MQTT client using intermediate CA

```bash
step certificate create foo foo.crt foo.key \
      --ca ca/certs/intermediate_ca.crt \
      --ca-key ca/secrets/intermediate_ca_key \
      --no-password \
      --insecure \
      --not-after 2400h
```

### Step 5. Create config map with client root CA

A trusted root CA certificate is required to validate the client certificate. To import a root certificate that can be used to validate client certificates, first import the certificate PEM as ConfigMap under the key client_ca.pem. Client certificates must be rooted in this CA for Azure IoT MQ to authenticate them.

```bash
kubectl create configmap client-ca --from-file=client_ca.pem -n azure-iot-operations
```

Check it:

```bash
kubectl describe configmap client-ca -n azure-iot-operations
```

### Step 6. Create attributes file for Authorization

You can use this command to check the information in the certificates:

```bash
step certificate inspect ca/certs/root_ca.crt
step certificate inspect ca/certs/intermediate_ca.crt
step certificate inspect foo.crt
```

In alternative you can also use the `openssl` command:

```bash
openssl x509 -in ca/certs/root_ca.crt -text -noout
openssl x509 -in ca/certs/intermediate_ca.crt -text -noout
openssl x509 -in foo.crt -text -noout
```

Use this information to create file `x509Attributes.toml`.

Create the secret:

```bash
kubectl create secret generic x509-attributes --from-file=x509Attributes.toml -n azure-iot-operations
```

### Step 7. Check the BrokerListener with TLS and authentication

Check that the default BrokerListener is TLS enabled and authentication is also enabled:

```bash
kubectl get brokerlistener listener -n azure-iot-operations -o yaml
```

![alt text](docs/assets/image-2.png)


### Step 8. Enable X.509 authentication in the BrokerAuthentication

Check default BrokerAuthentication configuration only with sat:

```bash
kubectl get brokerauthentication authn -n azure-iot-operations -o yaml
```

![alt text](docs/assets/image-3.png)

Apply new configuration to add X.509 authentication:

```bash
kubectl apply -f auth-x509.yaml
```

Check again the new config:

```bash
kubectl get brokerauthentication authn -n azure-iot-operations -o yaml
```

![alt text](docs/assets/image-4.png)

### Step 9. Create a CA file for the client

It needs both the client CA chain (root + intermediate) and also the server CA root.

```bash
# Get server root CA
kubectl get configmap aio-ca-trust-bundle-test-only -n azure-iot-operations -o jsonpath='{.data.ca\.crt}' > server_ca.crt

# Create chain PEM
cat ca/certs/root_ca.crt ca/certs/intermediate_ca.crt server_ca.crt > chain_server_client.pem
```

### Step 10. Test with mosquitto

To test from within the cluster let's deploy a sample client pod:

```bash
kubectl apply -f client.yaml
```

Copy certificate and key files into pod:

```bash
kubectl cp foo.crt azure-iot-operations/mqtt-client:/tmp/foo.crt
kubectl cp foo.key azure-iot-operations/mqtt-client:/tmp/foo.key
kubectl cp chain_server_client.pem azure-iot-operations/mqtt-client:/tmp/chain_server_client.pem
```

Open a shell into this pod to run commands:

```bash
kubectl exec --stdin --tty mqtt-client -n azure-iot-operations -- sh
```

And run this comand to publish messages:

```bash
mosquitto_pub -q 1 -t hello -d -V mqttv5 -m world2 -i thermostat -h aio-mq-dmqtt-frontend -p 8883 --cert /tmp/foo.crt --key /tmp/foo.key --cafile /tmp/chain_server_client.pem
```

![alt text](docs/assets/image-6.png)

Open another shell into the pod:

```bash
kubectl exec --stdin --tty mqtt-client -n azure-iot-operations -- sh
```

And run the `mosquitto_sub` tool to check the published messages:

```bash
mosquitto_sub -t hello -d -V mqttv5 -h aio-mq-dmqtt-frontend -p 8883 --cert /tmp/foo.crt --key /tmp/foo.key --cafile /tmp/chain_server_client.pem
```

You can also use the `mqttui` tool to check the published messages:

```bash
mqttui -b mqtts://aio-mq-dmqtt-frontend:8883 -u '$sat' --password $(cat /var/run/secrets/tokens/mq-sat) --insecure
```

![alt text](docs/assets/image-5.png)


### Step 11. Expose service to the outside

```bash
k get svc -n azure-iot-operations
```

![alt text](docs/assets/image-7.png)

Change the service from ClusterIp to LoadBalancer:

```bash
kubectl patch brokerlistener listener -n azure-iot-operations --type='json' -p='[{"op": "replace", "path": "/spec/serviceType", "value": "loadBalancer"}]'
```

Wait for the service to be updated:

```bash
kubectl get service aio-mq-dmqtt-frontend -n azure-iot-operations
```

![alt text](docs/assets/image-8.png)

### Step 12. Test from outside

Publish a message from outside the cluster:

```bash
mosquitto_pub -q 1 -t hello -d -V mqttv5 -m "world3 from outside" -i thermostat -h 172.30.226.19 -p 8883 --cert foo.crt --key foo.key --cafile chain_server_client.pem
```

![alt text](docs/assets/image-9.png)

Check with MQTTUI.

![alt text](docs/assets/image-10.png)

You can also use Port forwarding like describe [here](https://learn.microsoft.com/en-us/azure/iot-operations/manage-mqtt-connectivity/howto-test-connection#use-port-forwarding).

### Step 13. Test with a nodejs sample client

Just use sample in folder `node-app-test-client`.


## Broker Listerer TLS manual configuration

In case you need to replace the by default certificate used by TLS that only includes the cluster IP and the node IP, with a certificate that includes the DNS name of the broker and can also include a public IP if needed, you can follow these [steps](docs/tls-manual.md).