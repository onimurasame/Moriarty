#include "MoriartyActor.h"

AMoriartyActor::AMoriartyActor()
{
	PrimaryActorTick.bCanEverTick = true;
	MoriartyType = TEXT("object");
}

void AMoriartyActor::BeginPlay()
{
	Super::BeginPlay();
	
	// Register this actor with the local MCP / Moriarty manager if needed
}

void AMoriartyActor::Tick(float DeltaTime)
{
	Super::Tick(DeltaTime);
}

void AMoriartyActor::ApplyStateDelta(const FString& JsonChanges)
{
	// Parse JsonChanges and update physical properties
	// For example, if position changed in CSG, lerp to new position here
	
	// Can be extended in Blueprints
}
