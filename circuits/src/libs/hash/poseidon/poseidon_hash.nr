use poseidon::poseidon::bn254::{hash_1, hash_2, hash_3, hash_4, hash_5, hash_6};

pub fn poseidon_hash_1(inputs: [Field; 1]) -> Field {
    hash_1(inputs)
}

pub fn poseidon_hash_2(inputs: [Field; 2]) -> Field {
    hash_2(inputs)
}

pub fn poseidon_hash_3(inputs: [Field; 3]) -> Field {
    hash_3(inputs)
}

pub fn poseidon_hash_4(inputs: [Field; 4]) -> Field {
    hash_4(inputs)
}

pub fn poseidon_hash_5(inputs: [Field; 5]) -> Field {
    hash_5(inputs)
}

pub fn poseidon_hash_6(inputs: [Field; 6]) -> Field {
    hash_6(inputs)
}