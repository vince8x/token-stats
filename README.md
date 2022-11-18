## Ecash token stats

Calculate the token burned to check if chronik works correctly

## Usage:

yarn dev -- --token <tokenid>

## Approach

From the genesis slp transaction

- Count all the mint/send outputs
- Count all and track the inputs
- Remove the outputs alread spent --> circulation
- Token burned = token mint - token circulation

## Assumptions

The spentBy field in output from chronik is correct.
