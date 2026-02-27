echo "Show the size of the ZK circuit..."
bb gates -b target/flight_delay_insurance.json | grep "circuit"

# Scheme is: ultra_honk, num threads: 8
#         "circuit_size": ?

# @aztec/bb.js
#   - Performance and limitations: 
#     - Max circuit size is 2^19 gates (524,288). This is due to the underlying WASM 4GB memory limit.
# 
# Link: https://www.npmjs.com/package/@aztec/bb.js